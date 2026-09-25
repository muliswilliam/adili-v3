import pytest
from rest_framework.test import APIClient


@pytest.mark.usefixtures("seeded")
def test_finds_pin_by_id_number(api: APIClient) -> None:
    response = api.get("/kra/v1/pins", {"id_number": "27451863"})

    assert response.status_code == 200
    assert [taxpayer["pin"] for taxpayer in response.json()] == ["A004518637K"]


@pytest.mark.usefixtures("seeded")
def test_pin_search_without_id_number_returns_nothing(api: APIClient) -> None:
    assert api.get("/kra/v1/pins").json() == []


@pytest.mark.usefixtures("seeded")
def test_reports_non_compliance(api: APIClient) -> None:
    response = api.get("/kra/v1/pins/A002260778R/compliance")

    assert response.status_code == 200
    assert response.json()["status"] == "non_compliant"
    assert response.json()["valid_until"] is None


@pytest.mark.usefixtures("seeded")
def test_unknown_pin_is_not_found(api: APIClient) -> None:
    assert api.get("/kra/v1/pins/A000000000X").status_code == 404
    assert api.get("/kra/v1/pins/A000000000X/compliance").status_code == 404
