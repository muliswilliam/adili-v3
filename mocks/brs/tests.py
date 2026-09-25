import pytest
from rest_framework.test import APIClient


@pytest.mark.usefixtures("seeded")
def test_lists_directorships_of_person(api: APIClient) -> None:
    response = api.get("/brs/v1/persons/27451863/directorships")

    assert response.status_code == 200
    assert response.json() == [
        {
            "company_registration_number": "PVT-9XYZ2L4Q",
            "company_name": "Afya Bora Medical Supplies Limited",
            "company_status": "active",
            "role": "director_shareholder",
            "shares": 400,
            "appointed_on": "2022-02-14",
        }
    ]


@pytest.mark.usefixtures("seeded")
def test_company_lists_its_officers(api: APIClient) -> None:
    response = api.get("/brs/v1/companies/PVT-9XYZ2L4Q")

    assert response.status_code == 200
    assert [o["id_number"] for o in response.json()["officers"]] == ["24718355", "27451863"]


@pytest.mark.usefixtures("seeded")
def test_unknown_company_is_not_found(api: APIClient) -> None:
    assert api.get("/brs/v1/companies/PVT-NOPE").status_code == 404
