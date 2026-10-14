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
            return FakeResponse([{"lat": "45.52", "lon": "-122.68"}])
        return FakeResponse({
            "elements": [
                {
                    "type": "node",
                    "id": 123,
                    "lat": 45.51,
                    "lon": -122.67,
                    "tags": {
                        "name": "Community Neurology",
                        "healthcare:speciality": "neurology",
                        "addr:street": "Main Street",
                        "addr:housenumber": "12",
                        "website": "https://example.org",
                    },
                },
                {
                    "type": "node",
                    "id": 456,
                    "lat": 45.5,
                    "lon": -122.6,
                    "tags": {"healthcare:speciality": "neurology"},
                },
            ]
        })

    monkeypatch.setattr(specialists, "urlopen", fake_urlopen)
    result = specialists.search_specialists("Portland, OR", "neurology", 25)

    assert result["location"] == "Portland, OR"
    assert result["attribution"] == "© OpenStreetMap contributors"
    assert len(result["providers"]) == 1
    provider = result["providers"][0]
    assert provider["id"] == "node/123"
    assert provider["name"] == "Community Neurology"
    assert provider["address"] == "12 Main Street"
    assert provider["website"] == "https://example.org"
    assert provider["distance_miles"] > 0
    assert len(requests) == 2
    assert all(request.get_header("User-agent") == "MorrowResearchPortal/1.0" for request in requests)
    assert all(request.full_url.startswith(("https://nominatim.openstreetmap.org/", "https://overpass-api.de/")) for request in requests)
    assert timeouts == [specialists.REQUEST_TIMEOUT_SECONDS] * 2
    query = parse_qs(requests[1].data.decode())["data"][0]
    assert "around:40234,45.520000,-122.680000" in query
    assert '["healthcare:speciality"~"neurology",i]' in query
    assert "out center tags 100;" in query


def test_search_with_coordinates_uses_radius_specialty_filters_and_caches_results(
    monkeypatch,
):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        return FakeResponse({"elements": []})

    monkeypatch.setattr(specialists, "urlopen", fake_urlopen)
    first = specialists.search_specialists(
        "Current location", "movement-disorders", 10, 40.0, -70.0
    )
    second = specialists.search_specialists(
        "Current location", "movement-disorders", 10, 40.0, -70.0
    )

    assert first == second
    assert first["providers"] == []
    assert len(requests) == 1
    query = parse_qs(requests[0].data.decode())["data"][0]
    assert "around:16093,40.000000,-70.000000" in query
    assert "movement.?disorder|parkinson" in query


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


def test_rate_limiter_waits_between_requests_to_a_service(monkeypatch):
    times = iter([10.0, 10.0, 10.5, 11.0])
    waits = []
    monkeypatch.setattr(specialists.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(specialists.time, "sleep", waits.append)

    specialists._rate_limit("nominatim")
    specialists._rate_limit("nominatim")

    assert waits == [pytest.approx(0.5)]
