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
REQUEST_TIMEOUT_SECONDS = 10
SEARCH_CACHE_SECONDS = 15 * 60
SEARCH_CACHE_LIMIT = 128
RATE_LIMIT_SECONDS = 1.0
ATTRIBUTION = "© OpenStreetMap contributors"

SPECIALTY_FILTERS = {
    "neurology": (
        '["healthcare:speciality"~"neurology",i]',
        '["speciality"~"neurology",i]',
    ),
    "movement-disorders": (
        '["healthcare:speciality"~"movement.?disorder|parkinson",i]',
        '["speciality"~"movement.?disorder|parkinson",i]',
    ),
    "physical-therapy": (
        '["healthcare:speciality"~"physio|physical.?therap",i]',
        '["speciality"~"physio|physical.?therap",i]',
        '["healthcare"="physiotherapist"]',
        '["office"="physiotherapist"]',
    ),
}

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
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
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
    query = urlencode({"q": location, "format": "jsonv2", "limit": 1})
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
        f'{element}(around:{radius_meters},{latitude:.6f},{longitude:.6f}){tag_filter};'
        for element in ("node", "way", "relation")
        for tag_filter in filters
    )
    return f"[out:json][timeout:20];\n(\n{selectors}\n);\nout center tags 100;"


def _distance_miles(latitude: float, longitude: float, target_lat: float, target_lon: float) -> float:
    earth_radius_miles = 3958.7613
    lat1, lat2 = math.radians(latitude), math.radians(target_lat)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(target_lon - longitude)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * earth_radius_miles * math.asin(min(1.0, math.sqrt(haversine)))


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
        "address": address or None,
        "latitude": provider_lat,
        "longitude": provider_lon,
        "distance_miles": round(_distance_miles(latitude, longitude, provider_lat, provider_lon), 1),
        "website": website,
        "phone": phone if isinstance(phone, str) else None,
        "osm_url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
    }


def _cached_providers(
    latitude: float, longitude: float, category: str, radius_miles: int
) -> list[dict[str, Any]] | None:
    key = (round(latitude, 5), round(longitude, 5), category, radius_miles)
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
    radius_miles: int,
    providers: list[dict[str, Any]],
) -> None:
    key = (round(latitude, 5), round(longitude, 5), category, radius_miles)
    with _cache_lock:
        if len(_search_cache) >= SEARCH_CACHE_LIMIT:
            oldest = min(_search_cache, key=lambda item: _search_cache[item][0])
            _search_cache.pop(oldest, None)
        _search_cache[key] = (time.monotonic() + SEARCH_CACHE_SECONDS, copy.deepcopy(providers))


def search_specialists(
    location: str,
    category: str,
    radius_miles: int,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict[str, Any]:
    """Geocode a manual place or use supplied coordinates and query real OSM features."""
    if category not in SPECIALTY_FILTERS:
        raise ValueError("Unsupported specialist category.")
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

    providers = _cached_providers(latitude, longitude, category, radius_miles)
    if providers is None:
        query = _overpass_query(
            latitude, longitude, round(radius_miles * 1609.344), category
        )
        payload = _json_request(
            os.getenv("OVERPASS_URL", OVERPASS_URL),
            service="overpass",
            data=urlencode({"data": query}).encode("utf-8"),
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
            raise SpecialistServiceError(
                "OpenStreetMap returned an unexpected provider-search response."
            )
        providers = []
        seen: set[tuple[str, float, float]] = set()
        for element in payload["elements"]:
            provider = _provider_from_element(element, latitude, longitude)
            if provider is None:
                continue
            identity = (provider["name"].casefold(), round(provider["latitude"], 4), round(provider["longitude"], 4))
            if identity in seen:
                continue
            seen.add(identity)
            providers.append(provider)
        providers.sort(key=lambda provider: (provider["distance_miles"], provider["name"].casefold()))
        providers = providers[:100]
        _store_providers(latitude, longitude, category, radius_miles, providers)

    return {
        "location": location,
        "providers": providers,
        "attribution": ATTRIBUTION,
    }
