"""Responsible OpenStreetMap-backed specialist search."""

from __future__ import annotations

import copy
import json
import math
import os
import re
import threading
import time
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from typing import Any


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_FALLBACK_URL = "https://overpass.kumi.systems/api/interpreter"
# overpass.osm.ch was removed: it only serves Swiss data.
OVERPASS_FALLBACK_URLS = (OVERPASS_FALLBACK_URL,)
REQUEST_TIMEOUT_SECONDS = 10
OVERPASS_REQUEST_TIMEOUT_SECONDS = 15
# The directory serves an Indian user base; comma-separated ISO codes, empty for worldwide.
DEFAULT_COUNTRY_CODES = "in"
SEARCH_CACHE_SECONDS = 15 * 60
SEARCH_CACHE_LIMIT = 128
RATE_LIMIT_SECONDS = 1.0
ATTRIBUTION = "© OpenStreetMap contributors"

SPECIALTY_FILTERS = {
    "parkinsons-care": (
        '["healthcare:speciality"~"neurology|movement.?disorder|parkinson|physio|physical.?therap|rehab",i]',
        '["speciality"~"neurology|movement.?disorder|parkinson|physio|physical.?therap|rehab",i]',
        '["healthcare"~"hospital|clinic|doctor|physiotherapist|rehabilitation",i]',
        '["amenity"~"hospital|clinic|doctors",i]',
        '["office"~"ngo|charity",i]',
        '["name"~"parkinson",i]',
    ),
    "neurology": (
        '["healthcare:speciality"~"neurology",i]',
        '["speciality"~"neurology",i]',
        '["healthcare"="doctor"]',
        '["amenity"="doctors"]',
    ),
    "movement-disorders": (
        '["healthcare:speciality"~"movement.?disorder|parkinson",i]',
        '["speciality"~"movement.?disorder|parkinson",i]',
        '["name"~"parkinson",i]',
        '["healthcare"="doctor"]',
        '["amenity"="doctors"]',
    ),
    "physical-therapy": (
        '["healthcare:speciality"~"physio|physical.?therap",i]',
        '["speciality"~"physio|physical.?therap",i]',
        '["healthcare"="physiotherapist"]',
        '["office"="physiotherapist"]',
        '["amenity"="clinic"]',
    ),
    "hospitals-clinics": (
        '["healthcare"~"hospital|clinic",i]',
        '["amenity"~"hospital|clinic",i]',
    ),
    "organizations": (
        '["office"~"ngo|charity",i]',
        '["name"~"parkinson",i]',
    ),
}

NOMINATIM_SEARCH_TERMS = {
    "parkinsons-care": ("Parkinson", "neurology", "neuro", "hospital", "physiotherapy", "rehabilitation"),
    "neurology": ("neurology", "neuro", "neurologist", "hospital"),
    "movement-disorders": ("Parkinson", "movement disorder", "neurology", "neuro"),
    "physical-therapy": ("physiotherapy", "physiotherapist", "rehabilitation"),
    "hospitals-clinics": ("hospital", "clinic", "nursing home"),
    "organizations": ("Parkinson", "Parkinson support group", "neurological society", "NGO"),
}

# Nominatim results are kept only when the mapped feature is actually a
# healthcare facility or organisation, never a road, building or locality
# that merely has "doctor" or "hospital" in its name.
NOMINATIM_ALLOWED_TYPES = {
    "amenity": {"hospital", "clinic", "doctors", "nursing_home", "social_facility"},
    "healthcare": None,  # any healthcare=* value
    "office": {"ngo", "charity", "association", "foundation", "physician", "therapist"},
}


# Listings whose names signal the requested specialty are shown before
# general facilities, which are otherwise ordered by distance.
RELEVANT_NAME_PATTERNS = {
    "parkinsons-care": re.compile(r"parkinson|neuro|brain|movement|physio|rehab", re.I),
    "neurology": re.compile(r"neuro|brain|parkinson|movement", re.I),
    "movement-disorders": re.compile(r"parkinson|movement|neuro", re.I),
    "physical-therapy": re.compile(r"physio|rehab|therap", re.I),
    "organizations": re.compile(r"parkinson|neuro", re.I),
}


def _country_codes() -> str:
    return os.getenv("DIRECTORY_COUNTRY_CODES", DEFAULT_COUNTRY_CODES).strip()


_rate_lock = threading.Lock()
_last_request: dict[str, float] = {}
_cache_lock = threading.Lock()
_search_cache: dict[tuple[float, float, str, int], tuple[float, list[dict[str, Any]]]] = {}


class SpecialistServiceError(RuntimeError):
    """Raised when an OpenStreetMap search service cannot return reliable data."""


def _user_agent() -> str:
    contact = os.getenv("OSM_CONTACT_EMAIL", "").strip()
    product = os.getenv("OSM_USER_AGENT", "MorrowResearchPortal/1.0").strip()
    if contact:
        return f"{product} (mailto:{contact})"
    return product


def _rate_limit(service: str) -> None:
    with _rate_lock:
        now = time.monotonic()
        previous_request = _last_request.get(service)
        wait = (
            RATE_LIMIT_SECONDS - (now - previous_request)
            if previous_request is not None
            else 0.0
        )
        if wait > 0:
            time.sleep(wait)
        _last_request[service] = time.monotonic()


def _json_request(
    url: str, *, service: str, data: bytes | None = None
) -> Any:
    _rate_limit(service)
    request = Request(
        url,
        data=data,
        headers={
            "User-Agent": _user_agent(),
            "Accept": "application/json",
            **({"Content-Type": "application/x-www-form-urlencoded"} if data else {}),
        },
        method="POST" if data else "GET",
    )
    try:
        timeout = (
            OVERPASS_REQUEST_TIMEOUT_SECONDS
            if service == "overpass"
            else REQUEST_TIMEOUT_SECONDS
        )
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except (
        HTTPError,
        URLError,
        TimeoutError,
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as exc:
        raise SpecialistServiceError(
            "OpenStreetMap search is temporarily unavailable. Please try again later."
        ) from exc


@lru_cache(maxsize=256)
def _geocode_location(location: str) -> tuple[float, float] | None:
    params = {"q": location, "format": "jsonv2", "limit": 1}
    if _country_codes():
        params["countrycodes"] = _country_codes()
    query = urlencode(params)
    payload = _json_request(
        f"{os.getenv('NOMINATIM_URL', NOMINATIM_URL)}?{query}",
        service="nominatim",
    )
    if not isinstance(payload, list):
        raise SpecialistServiceError(
            "OpenStreetMap returned an unexpected location-search response."
        )
    if not payload:
        return None
    try:
        latitude = float(payload[0]["lat"])
        longitude = float(payload[0]["lon"])
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise SpecialistServiceError(
            "OpenStreetMap returned an invalid location result."
        ) from exc
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise SpecialistServiceError("OpenStreetMap returned an invalid location result.")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise SpecialistServiceError("OpenStreetMap returned an invalid location result.")
    return latitude, longitude


def _overpass_query(latitude: float, longitude: float, radius_meters: int, category: str) -> str:
    filters = SPECIALTY_FILTERS[category]
    selectors = "\n".join(
        f'nwr(around:{radius_meters},{latitude:.6f},{longitude:.6f}){tag_filter};'
        for tag_filter in filters
    )
    return f"[out:json][timeout:25];\n(\n{selectors}\n);\nout center tags 100;"


def _distance_km(latitude: float, longitude: float, target_lat: float, target_lon: float) -> float:
    earth_radius_km = 6371.0088
    lat1, lat2 = math.radians(latitude), math.radians(target_lat)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(target_lon - longitude)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * earth_radius_km * math.asin(min(1.0, math.sqrt(haversine)))


def _provider_from_element(
    element: Any, latitude: float, longitude: float
) -> dict[str, Any] | None:
    if not isinstance(element, dict) or not isinstance(element.get("tags"), dict):
        return None
    tags = element["tags"]
    name = tags.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    center = element.get("center") if isinstance(element.get("center"), dict) else {}
    try:
        provider_lat = float(element.get("lat", center.get("lat")))
        provider_lon = float(element.get("lon", center.get("lon")))
        osm_id = int(element["id"])
        osm_type = str(element["type"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(provider_lat) or not math.isfinite(provider_lon):
        return None
    if str(tags.get("office", "")).lower() in {"ngo", "charity"}:
        listing_type = "Organization / NGO"
    elif "parkinson" in name.casefold():
        listing_type = "Parkinson’s organization or service"
    elif tags.get("healthcare") == "hospital" or tags.get("amenity") == "hospital":
        listing_type = "Hospital"
    elif tags.get("healthcare") == "clinic" or tags.get("amenity") == "clinic":
        listing_type = "Clinic"
    elif (
        tags.get("healthcare") == "physiotherapist"
        or tags.get("office") == "physiotherapist"
        or "physio" in str(tags.get("healthcare:speciality", "")).casefold()
    ):
        listing_type = "Physical therapy"
    elif (
        tags.get("healthcare") == "doctor"
        or tags.get("amenity") == "doctors"
        or tags.get("healthcare:speciality")
        or tags.get("speciality")
    ):
        listing_type = "Doctor / specialist"
    else:
        listing_type = "Healthcare listing"
    address = tags.get("addr:full")
    if not address:
        address = ", ".join(
            part for part in (
                " ".join(
                    value for value in (
                        tags.get("addr:housenumber"),
                        tags.get("addr:street"),
                    ) if isinstance(value, str) and value.strip()
                ),
                tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village"),
                tags.get("addr:postcode"),
            ) if isinstance(part, str) and part.strip()
        )
    website = tags.get("contact:website") or tags.get("website")
    if not isinstance(website, str) or not website.lower().startswith(("http://", "https://")):
        website = None
    phone = tags.get("contact:phone") or tags.get("phone")
    return {
        "id": f"{osm_type}/{osm_id}",
        "name": name.strip(),
        "listing_type": listing_type,
        "address": address or None,
        "latitude": provider_lat,
        "longitude": provider_lon,
        "distance_km": round(_distance_km(latitude, longitude, provider_lat, provider_lon), 1),
        "website": website,
        "phone": phone if isinstance(phone, str) else None,
        "osm_url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
    }


def _nominatim_viewbox(
    latitude: float, longitude: float, radius_km: int
) -> str:
    latitude_delta = radius_km / 110.574
    longitude_delta = min(
        180.0,
        radius_km / (111.320 * max(math.cos(math.radians(latitude)), 0.01)),
    )
    return ",".join(
        f"{coordinate:.6f}"
        for coordinate in (
            max(-180.0, longitude - longitude_delta),
            max(-90.0, latitude - latitude_delta),
            min(180.0, longitude + longitude_delta),
            min(90.0, latitude + latitude_delta),
        )
    )


def _nominatim_listing_type(result: dict[str, Any], name: str) -> str | None:
    category = str(result.get("category") or result.get("class") or "").lower()
    kind = str(result.get("type") or "").lower()
    allowed = NOMINATIM_ALLOWED_TYPES.get(category, set())
    is_parkinson_named = "parkinson" in name.casefold() and category not in {"highway", "place", "boundary"}
    if not is_parkinson_named and (allowed is not None and kind not in allowed):
        return None
    if category == "office" or kind in {"ngo", "charity", "social_facility"}:
        return "Organization / NGO"
    if is_parkinson_named:
        return "Parkinson’s organization or service"
    if kind == "hospital":
        return "Hospital"
    if kind in {"physiotherapist", "rehabilitation", "therapist"}:
        return "Physical therapy"
    if kind in {"doctors", "doctor", "physician"}:
        return "Doctor / specialist"
    if kind in {"clinic", "nursing_home", "centre"}:
        return "Clinic"
    return "Healthcare listing"


def _provider_from_nominatim(
    result: Any,
    latitude: float,
    longitude: float,
    radius_km: int,
) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    name = result.get("name")
    if not isinstance(name, str) or not name.strip():
        display_name = result.get("display_name")
        name = display_name.split(",", 1)[0].strip() if isinstance(display_name, str) else ""
    if not name:
        return None
    listing_type = _nominatim_listing_type(result, name)
    if listing_type is None:
        return None
    try:
        provider_lat = float(result["lat"])
        provider_lon = float(result["lon"])
        osm_id = int(result["osm_id"])
        osm_type = str(result["osm_type"]).lower()
    except (KeyError, TypeError, ValueError):
        return None
    if (
        not math.isfinite(provider_lat)
        or not math.isfinite(provider_lon)
        or not -90 <= provider_lat <= 90
        or not -180 <= provider_lon <= 180
        or osm_type not in {"node", "way", "relation"}
    ):
        return None
    distance = _distance_km(latitude, longitude, provider_lat, provider_lon)
    if distance > radius_km:
        return None
    address = result.get("display_name")
    if not isinstance(address, str):
        address = None
    extra_tags = result.get("extratags")
    if not isinstance(extra_tags, dict):
        extra_tags = {}
    website = extra_tags.get("website") or extra_tags.get("contact:website")
    if not isinstance(website, str) or not website.lower().startswith(("http://", "https://")):
        website = None
    phone = extra_tags.get("phone") or extra_tags.get("contact:phone")
    return {
        "id": f"{osm_type}/{osm_id}",
        "name": name,
        "listing_type": listing_type,
        "address": address,
        "latitude": provider_lat,
        "longitude": provider_lon,
        "distance_km": round(distance, 1),
        "website": website,
        "phone": phone if isinstance(phone, str) else None,
        "osm_url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
    }


def _search_nominatim_providers(
    location: str,
    category: str,
    latitude: float,
    longitude: float,
    radius_km: int,
) -> list[dict[str, Any]]:
    providers: list[dict[str, Any]] = []
    failures: list[SpecialistServiceError] = []
    viewbox = _nominatim_viewbox(latitude, longitude, radius_km)
    for term in NOMINATIM_SEARCH_TERMS[category]:
        params = {
            # The bounded viewbox already restricts results to the area.
            "q": term,
            "format": "jsonv2",
            "limit": 40,
            "addressdetails": 1,
            "extratags": 1,
            "namedetails": 1,
            "viewbox": viewbox,
            "bounded": 1,
        }
        if _country_codes():
            params["countrycodes"] = _country_codes()
        query = urlencode(params)
        try:
            payload = _json_request(
                f"{os.getenv('NOMINATIM_URL', NOMINATIM_URL)}?{query}",
                service="nominatim",
            )
        except SpecialistServiceError as exc:
            failures.append(exc)
            continue
        if not isinstance(payload, list):
            failures.append(
                SpecialistServiceError(
                    "OpenStreetMap returned an unexpected provider-search response."
                )
            )
            continue
        for result in payload:
            provider = _provider_from_nominatim(result, latitude, longitude, radius_km)
            if provider is not None:
                providers.append(provider)

    if not providers and failures:
        raise failures[-1]
    unique: dict[tuple[str, float, float], dict[str, Any]] = {}
    for provider in providers:
        identity = (
            provider["name"].casefold(),
            round(provider["latitude"], 3),
            round(provider["longitude"], 3),
        )
        unique.setdefault(identity, provider)
    relevant = RELEVANT_NAME_PATTERNS.get(category)
    return sorted(
        unique.values(),
        key=lambda provider: (
            0 if relevant and relevant.search(provider["name"]) else 1,
            provider["distance_km"],
            provider["name"].casefold(),
        ),
    )[:100]


def _cached_providers(
    latitude: float, longitude: float, category: str, radius_km: int
) -> list[dict[str, Any]] | None:
    key = (round(latitude, 5), round(longitude, 5), category, radius_km)
    now = time.monotonic()
    with _cache_lock:
        cached = _search_cache.get(key)
        if cached and cached[0] > now:
            return copy.deepcopy(cached[1])
        if cached:
            _search_cache.pop(key, None)
    return None


def _store_providers(
    latitude: float,
    longitude: float,
    category: str,
    radius_km: int,
    providers: list[dict[str, Any]],
) -> None:
    key = (round(latitude, 5), round(longitude, 5), category, radius_km)
    with _cache_lock:
        if len(_search_cache) >= SEARCH_CACHE_LIMIT:
            oldest = min(_search_cache, key=lambda item: _search_cache[item][0])
            _search_cache.pop(oldest, None)
        _search_cache[key] = (time.monotonic() + SEARCH_CACHE_SECONDS, copy.deepcopy(providers))


def _search_overpass_providers(
    latitude: float, longitude: float, category: str, radius_km: int
) -> list[dict[str, Any]]:
    query = _overpass_query(latitude, longitude, round(radius_km * 1000), category)
    configured_url = os.getenv("OVERPASS_URL")
    endpoints = [configured_url or OVERPASS_URL]
    if not configured_url:
        endpoints.extend(OVERPASS_FALLBACK_URLS)
    last_error: SpecialistServiceError | None = None
    for endpoint in endpoints:
        try:
            payload = _json_request(
                endpoint, service="overpass", data=urlencode({"data": query}).encode("utf-8")
            )
            if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
                raise SpecialistServiceError(
                    "OpenStreetMap returned an unexpected provider-search response."
                )
            break
        except SpecialistServiceError as exc:
            last_error = exc
    else:
        raise last_error or SpecialistServiceError("OpenStreetMap search is temporarily unavailable.")
    providers: list[dict[str, Any]] = []
    seen: set[tuple[str, float, float]] = set()
    for element in payload["elements"]:
        provider = _provider_from_element(element, latitude, longitude)
        if provider is None or provider["distance_km"] > radius_km:
            continue
        identity = (
            provider["name"].casefold(),
            round(provider["latitude"], 4),
            round(provider["longitude"], 4),
        )
        if identity in seen:
            continue
        seen.add(identity)
        providers.append(provider)
    providers.sort(key=lambda provider: (provider["distance_km"], provider["name"].casefold()))
    return providers[:100]


def search_specialists(
    location: str,
    category: str,
    radius_km: int,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict[str, Any]:
    """Geocode a manual place or use supplied coordinates and query real OSM features."""
    if category not in SPECIALTY_FILTERS:
        raise ValueError("Unsupported care-directory category.")
    if not isinstance(radius_km, int) or not 1 <= radius_km <= 500:
        raise ValueError("Search radius must be between 1 and 500 kilometres.")
    if (latitude is None) != (longitude is None):
        raise ValueError("Both latitude and longitude are required together.")
    if latitude is None or longitude is None:
        normalized_location = re.sub(r"\s+", " ", location.strip())
        center = _geocode_location(normalized_location)
        if center is None:
            return {"location": location, "providers": [], "attribution": ATTRIBUTION}
        latitude, longitude = center
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise ValueError("Location coordinates must be finite.")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("Location coordinates are outside the valid range.")

    providers = _cached_providers(latitude, longitude, category, radius_km)
    if providers is None:
        # Nominatim POI search (filtered to real healthcare features) is fast and
        # reliable; Overpass is only a fallback because public instances are
        # frequently overloaded.
        nominatim_error: SpecialistServiceError | None = None
        try:
            providers = _search_nominatim_providers(location, category, latitude, longitude, radius_km)
        except SpecialistServiceError as exc:
            providers, nominatim_error = [], exc
        if not providers:
            try:
                providers = _search_overpass_providers(latitude, longitude, category, radius_km)
            except SpecialistServiceError:
                if nominatim_error is not None:
                    raise nominatim_error
                raise
        _store_providers(latitude, longitude, category, radius_km, providers)

    return {
        "location": location,
        "providers": providers,
        "attribution": ATTRIBUTION,
    }
