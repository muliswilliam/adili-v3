import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from config import faults
from config.faults import is_paused
from demo.fixtures import load_extra_people, load_roster_rows
from demo.models import RegistryState
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
def test_every_demo_adult_has_a_kra_pin() -> None:
    ids = [row.national_id for row in load_roster_rows()]
    ids += [person.national_id for person in load_extra_people()]
    assert Taxpayer.objects.filter(id_number__in=ids).count() == len(ids)


@pytest.mark.usefixtures("seeded")
def test_rate_limit_reset_is_seconds_until_the_window_ends(
    api: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1_800_000_000 starts a minute window, so 44.7 s are left in it.
    monkeypatch.setattr(faults, "_now", lambda: 1_800_000_000 + 15.3)
    response = api.get("/kra/v1/pins", {"id_number": "27451863"})
    assert response.headers["RateLimit-Reset"] == "45"


@pytest.mark.usefixtures("seeded")
def test_rate_limit_reset_is_at_least_one_second(
    api: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(faults, "_now", lambda: 1_800_000_000 + 59.999)
    response = api.get(
        "/kra/v1/pins", {"id_number": "27451863"}, headers={"X-Mock-Rate-Limited": "1"}
    )
    assert response.status_code == 429
    assert response.headers["RateLimit-Reset"] == "1"


@override_settings(MOCK_REGISTRY_PAUSED={"kra"})
@pytest.mark.usefixtures("seeded")
def test_registry_paused_by_env_can_be_resumed(api: APIClient) -> None:
    assert api.get("/demo/registries/kra").json() == {"system": "kra", "paused": True}
    assert api.get("/kra/v1/pins", {"id_number": "27451863"}).status_code == 503

    assert api.post("/demo/registries/kra/resume").status_code == 200

    assert api.get("/demo/registries/kra").json() == {"system": "kra", "paused": False}
    assert api.get("/kra/v1/pins", {"id_number": "27451863"}).status_code == 200

    api.post("/demo/registries/kra/pause")
    assert api.get("/kra/v1/pins", {"id_number": "27451863"}).status_code == 503


@pytest.mark.usefixtures("seeded")
def test_pause_state_is_shared_through_the_database(api: APIClient) -> None:
    # Another worker (or a reloaded dev server) sees the same row, not process memory.
    api.post("/demo/registries/brs/pause")
    assert RegistryState.objects.get(system="brs").paused

    faults.reset_rate_limits()
    assert api.get("/demo/registries/brs").json()["paused"] is True


@pytest.mark.usefixtures("seeded")
def test_unknown_registry_cannot_be_paused(api: APIClient) -> None:
    assert api.post("/demo/registries/iprs/pause").status_code == 404


@pytest.mark.usefixtures("seeded")
def test_registry_failure_header_is_case_insensitive(api: APIClient) -> None:
    response = api.get(
        "/ntsa/v1/owners/27451863/vehicles", headers={"X-Mock-Failure": "UNAVAILABLE"}
    )
    assert response.status_code == 503
    assert response.headers["X-Mock-System"] == "ntsa"


@override_settings(MOCK_FAILURES={"ardhisasa": "error"})
@pytest.mark.usefixtures("seeded")
def test_registry_failure_env_flag_applies(api: APIClient) -> None:
    assert api.get("/ardhisasa/v1/owners/27451863/parcels").status_code == 500
