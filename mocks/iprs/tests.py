import time

import pytest
from rest_framework.test import APIClient

from demo.fixtures import load_roster_rows


@pytest.mark.usefixtures("seeded")
def test_returns_person_by_id_number(api: APIClient) -> None:
    response = api.get("/iprs/v1/persons/27451863")

    assert response.status_code == 200
    assert response.json() == {
        "id_number": "27451863",
        "first_name": "Wanjiku",
        "middle_name": "Njoki",
        "last_name": "Kamau",
        "date_of_birth": "1984-03-14",
        "sex": "F",
        "place_of_birth": "Kiambu",
        "date_of_issue": "2002-01-15",
    }


@pytest.mark.usefixtures("seeded")
def test_unknown_id_number_is_not_found(api: APIClient) -> None:
    assert api.get("/iprs/v1/persons/99999999").status_code == 404


@pytest.mark.usefixtures("seeded")
def test_every_roster_person_is_in_iprs(api: APIClient) -> None:
    rows = load_roster_rows()
    assert rows

    for row in rows:
        response = api.get(f"/iprs/v1/persons/{row.national_id}")
        assert response.status_code == 200, row.national_id
        body = response.json()
        assert body["first_name"] in row.full_name
        assert body["last_name"] in row.full_name


@pytest.mark.usefixtures("seeded")
def test_latency_header_delays_lookup(api: APIClient) -> None:
    started = time.perf_counter()
    response = api.get("/iprs/v1/persons/27451863", headers={"X-Mock-Latency-Ms": "80"})
    elapsed_ms = (time.perf_counter() - started) * 1000

    assert response.status_code == 200
    assert elapsed_ms >= 80


@pytest.mark.usefixtures("seeded")
@pytest.mark.parametrize(
    ("failure", "status"),
    [("timeout", 504), ("unavailable", 503), ("error", 500)],
)
def test_failure_header_injects_status(api: APIClient, failure: str, status: int) -> None:
    response = api.get("/iprs/v1/persons/27451863", headers={"X-Mock-Failure": failure})
    assert response.status_code == status


@pytest.mark.usefixtures("seeded")
def test_failure_header_is_case_insensitive(api: APIClient) -> None:
    response = api.get("/iprs/v1/persons/27451863", headers={"X-Mock-Failure": " Timeout "})
    assert response.status_code == 504
