import json
from urllib.error import URLError
from urllib.parse import parse_qs

import pytest

from backend import specialists


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


@pytest.fixture(autouse=True)
def reset_specialist_caches(monkeypatch):
    specialists._geocode_location.cache_clear()
    specialists._search_cache.clear()
    specialists._last_request.clear()
    yield
    specialists._geocode_location.cache_clear()
    specialists._search_cache.clear()


def test_manual_search_uses_identified_timed_osm_requests_and_real_tagged_features(
    monkeypatch,
):
    requests = []
    timeouts = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        timeouts.append(timeout)
        if request.data is None:
            # First GET geocodes the city; later GETs are POI searches that find nothing.
            return FakeResponse([{"lat": "18.52", "lon": "73.85"}] if len(requests) == 1 else [])
        return FakeResponse({
            "elements": [
                {
                    "type": "node",
                    "id": 123,
                    "lat": 18.51,
                    "lon": 73.84,
                    "tags": {
                        "name": "Community Neurology",
                        "healthcare:speciality": "neurology",
                        "addr:street": "FC Road",
                        "addr:housenumber": "12",
                        "website": "https://example.org",
                    },
                },
                {
                    "type": "node",
                    "id": 456,
                    "lat": 18.5,
                    "lon": 73.8,
                    "tags": {"healthcare:speciality": "neurology"},
                },
            ]
        })

    monkeypatch.setattr(specialists, "urlopen", fake_urlopen)
    monkeypatch.setattr(specialists, "_rate_limit", lambda _service: None)
    result = specialists.search_specialists("Pune", "neurology", 25)

    assert result["location"] == "Pune"
    assert result["attribution"] == "© OpenStreetMap contributors"
    assert len(result["providers"]) == 1
    provider = result["providers"][0]
    assert provider["id"] == "node/123"
    assert provider["name"] == "Community Neurology"
    assert provider["listing_type"] == "Doctor / specialist"
    assert provider["address"] == "12 FC Road"
    assert provider["website"] == "https://example.org"
    assert provider["distance_km"] > 0
    terms = len(specialists.NOMINATIM_SEARCH_TERMS["neurology"])
    assert len(requests) == 1 + terms + 1
    assert all(request.get_header("User-agent") == "MorrowResearchPortal/1.0" for request in requests)
    assert all(request.full_url.startswith(("https://nominatim.openstreetmap.org/", "https://overpass-api.de/")) for request in requests)
    assert all("countrycodes=in" in request.full_url for request in requests[:-1])
    assert timeouts[0] == specialists.REQUEST_TIMEOUT_SECONDS
    assert timeouts[-1] == specialists.OVERPASS_REQUEST_TIMEOUT_SECONDS
    query = parse_qs(requests[-1].data.decode())["data"][0]
    assert "around:25000,18.520000,73.850000" in query
    assert '["healthcare:speciality"~"neurology",i]' in query
    assert "out center tags 100;" in query


def test_parkinsons_care_search_includes_facilities_services_and_organizations():
    query = specialists._overpass_query(19.03, 73.02, 250_000, "parkinsons-care")

    assert "around:250000,19.030000,73.020000" in query
    assert '["healthcare"~"hospital|clinic|doctor|physiotherapist|rehabilitation",i]' in query
    assert '["amenity"~"hospital|clinic|doctors",i]' in query
    assert '["office"~"ngo|charity",i]' in query
    assert '["name"~"parkinson",i]' in query


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"office": "ngo"}, "Organization / NGO"),
        ({"healthcare": "hospital"}, "Hospital"),
        ({"amenity": "clinic"}, "Clinic"),
        ({"healthcare:speciality": "neurology"}, "Doctor / specialist"),
    ],
)
def test_provider_listing_type_is_described_from_openstreetmap_tags(tags, expected):
    provider = specialists._provider_from_element(
        {
            "type": "node",
            "id": 5,
            "lat": 19.03,
            "lon": 73.02,
            "tags": {"name": "Mapped care listing", **tags},
        },
        19.03,
        73.02,
    )

    assert provider["listing_type"] == expected


def test_search_with_coordinates_uses_radius_specialty_filters_and_caches_results(
    monkeypatch,
):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        if request.full_url.startswith(specialists.NOMINATIM_URL):
            return FakeResponse([])
        return FakeResponse({"elements": []})

    monkeypatch.setattr(specialists, "urlopen", fake_urlopen)
    monkeypatch.setattr(specialists, "_rate_limit", lambda _service: None)
    first = specialists.search_specialists(
        "Current location", "movement-disorders", 10, 19.0, 72.8
    )
    second = specialists.search_specialists(
        "Current location", "movement-disorders", 10, 19.0, 72.8
    )

    assert first == second
    assert first["providers"] == []
    assert len(requests) == len(specialists.NOMINATIM_SEARCH_TERMS["movement-disorders"]) + 1
    query = parse_qs(requests[-1].data.decode())["data"][0]
    assert "around:10000,19.000000,72.800000" in query
    assert "movement.?disorder|parkinson" in query


def test_nominatim_poi_results_are_filtered_to_real_healthcare_features(monkeypatch):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        if len(requests) > 1:
            return FakeResponse([])
        return FakeResponse([
            {"osm_type": "way", "osm_id": 321, "name": "Parkinson Support Centre", "category": "office",
             "type": "ngo", "lat": "19.04", "lon": "73.02",
             "display_name": "Parkinson Support Centre, Navi Mumbai, Maharashtra",
             "extratags": {"website": "https://example.org"}},
            {"osm_type": "node", "osm_id": 1, "name": "City Hospital", "category": "amenity",
             "type": "hospital", "lat": "19.03", "lon": "73.03", "display_name": "City Hospital"},
            {"osm_type": "node", "osm_id": 2, "name": "Doctor Ramjibhai Chowk", "category": "highway",
             "type": "junction", "lat": "19.03", "lon": "73.02", "display_name": "Doctor Ramjibhai Chowk"},
            {"osm_type": "way", "osm_id": 3, "name": "Doctor Block", "category": "building",
             "type": "yes", "lat": "19.03", "lon": "73.02", "display_name": "Doctor Block"},
        ])

    monkeypatch.setattr(specialists, "urlopen", fake_urlopen)
    monkeypatch.setattr(specialists, "_rate_limit", lambda _service: None)

    result = specialists.search_specialists("Navi Mumbai", "organizations", 250, 19.03, 73.02)

    names = {provider["name"]: provider for provider in result["providers"]}
    assert set(names) == {"Parkinson Support Centre", "City Hospital"}
    assert names["Parkinson Support Centre"]["listing_type"] == "Organization / NGO"
    assert names["Parkinson Support Centre"]["website"] == "https://example.org"
    assert names["City Hospital"]["listing_type"] == "Hospital"
    assert not any(request.data for request in requests), "Overpass is only a fallback"


def test_unknown_city_returns_empty_without_provider_query(monkeypatch):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        return FakeResponse([])

    monkeypatch.setattr(specialists, "urlopen", fake_urlopen)
    result = specialists.search_specialists("No such place", "neurology", 25)

    assert result["providers"] == []
    assert len(requests) == 1


def test_provider_failure_is_explicit_and_invalid_coordinates_are_rejected(monkeypatch):
    monkeypatch.setattr(
        specialists, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("offline"))
    )
    with pytest.raises(specialists.SpecialistServiceError, match="temporarily unavailable"):
        specialists.search_specialists("Portland", "neurology", 25)
    with pytest.raises(ValueError, match="required together"):
        specialists.search_specialists("Current location", "neurology", 25, 45.0)


def test_overpass_failure_uses_fallback_endpoint(monkeypatch):
    endpoints = []

    def fake_request(url, **kwargs):
        if url.startswith(specialists.NOMINATIM_URL):
            return []
        endpoints.append(url)
        if len(endpoints) < 2:
            raise specialists.SpecialistServiceError("primary unavailable")
        return {
            "elements": [
                {
                    "type": "node",
                    "id": 123,
                    "lat": 19.0,
                    "lon": 72.8,
                    "tags": {"name": "Mapped neurology clinic", "amenity": "clinic"},
                }
            ]
        }

    monkeypatch.setattr(specialists, "_json_request", fake_request)
    result = specialists.search_specialists("Current location", "neurology", 25, 19.0, 72.8)

    assert result["providers"][0]["name"] == "Mapped neurology clinic"
    assert endpoints == [specialists.OVERPASS_URL, *specialists.OVERPASS_FALLBACK_URLS]


def test_rate_limiter_waits_between_requests_to_a_service(monkeypatch):
    times = iter([10.0, 10.0, 10.5, 11.0])
    waits = []
    monkeypatch.setattr(specialists.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(specialists.time, "sleep", waits.append)

    specialists._rate_limit("nominatim")
    specialists._rate_limit("nominatim")

    assert waits == [pytest.approx(0.5)]
