import pytest
from rest_framework.test import APIClient


@pytest.mark.usefixtures("seeded")
def test_lists_parcels_owned_by_person(api: APIClient) -> None:
    response = api.get("/ardhisasa/v1/owners/27451863/parcels")

    assert response.status_code == 200
    assert {p["county"] for p in response.json()} == {"Kiambu", "Kajiado"}


@pytest.mark.usefixtures("seeded")
def test_returns_parcel_whose_number_contains_slashes(api: APIClient) -> None:
    response = api.get("/ardhisasa/v1/parcels/KAJIADO/KITENGELA/59821")

    assert response.status_code == 200
    assert response.json()["area_hectares"] == "2.0235"


@pytest.mark.usefixtures("seeded")
def test_unknown_parcel_is_not_found(api: APIClient) -> None:
    assert api.get("/ardhisasa/v1/parcels/NAIROBI/BLOCK 1/1").status_code == 404
