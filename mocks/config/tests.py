import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from config.registry_control import is_paused
from demo.seed import PEOPLE
from kra.models import Taxpayer


@pytest.mark.django_db
def test_health_reports_up_when_database_answers(api: APIClient) -> None:
    response = api.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "up"}


@pytest.mark.usefixtures("seeded")
def test_registry_responses_include_rate_limit_headers(api: APIClient) -> None:
    response = api.get("/kra/v1/pins", {"id_number": "27451863"})

    assert response.status_code == 200
    assert response.headers["RateLimit-Limit"] == "60"
    assert response.headers["RateLimit-Remaining"] == "59"
    assert response.headers["X-Mock-System"] == "kra"


@pytest.mark.usefixtures("seeded")
def test_pause_makes_registry_unavailable(api: APIClient) -> None:
    paused = api.post("/demo/registries/ntsa/pause")
    assert paused.status_code == 200
    assert is_paused("ntsa")

    response = api.get("/ntsa/v1/owners/27451863/vehicles")
    assert response.status_code == 503

    api.post("/demo/registries/ntsa/resume")
    assert api.get("/ntsa/v1/owners/27451863/vehicles").status_code == 200


@pytest.mark.usefixtures("seeded")
def test_failure_header_injects_timeout(api: APIClient) -> None:
    response = api.get(
        "/brs/v1/persons/27451863/directorships",
        headers={"X-Mock-Failure": "timeout"},
    )
    assert response.status_code == 504


@pytest.mark.usefixtures("seeded")
def test_rate_limited_header_returns_429(api: APIClient) -> None:
    response = api.get(
        "/ardhisasa/v1/owners/27451863/parcels",
        headers={"X-Mock-Rate-Limited": "1"},
    )
    assert response.status_code == 429
    assert response.headers["RateLimit-Remaining"] == "59"


@override_settings(MOCK_REGISTRY_RATE_LIMIT=1)
@pytest.mark.usefixtures("seeded")
def test_rate_limit_trips_on_second_call(api: APIClient) -> None:
    first = api.get("/kra/v1/pins", {"id_number": "27451863"})
    second = api.get("/kra/v1/pins", {"id_number": "27451863"})

    assert first.status_code == 200
    assert second.status_code == 429


@pytest.mark.usefixtures("seeded")
def test_every_demo_person_has_a_kra_pin() -> None:
    ids = [person.id_number for person in PEOPLE]
    assert Taxpayer.objects.filter(id_number__in=ids).count() == len(ids)
