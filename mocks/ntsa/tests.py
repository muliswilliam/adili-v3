import pytest
from rest_framework.test import APIClient


@pytest.mark.usefixtures("seeded")
def test_lists_vehicles_owned_by_person(api: APIClient) -> None:
    response = api.get("/ntsa/v1/owners/27451863/vehicles")

    assert response.status_code == 200
    assert [v["registration_number"] for v in response.json()] == ["KCX 214J", "KDK 482M"]


@pytest.mark.usefixtures("seeded")
def test_owner_without_vehicles_gets_empty_list(api: APIClient) -> None:
    assert api.get("/ntsa/v1/owners/31552094/vehicles").json() == []


@pytest.mark.usefixtures("seeded")
def test_unknown_registration_is_not_found(api: APIClient) -> None:
    assert api.get("/ntsa/v1/vehicles/KZZ 000Z").status_code == 404
