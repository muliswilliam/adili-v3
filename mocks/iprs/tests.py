import pytest
from rest_framework.test import APIClient


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
