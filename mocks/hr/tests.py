import pytest
from rest_framework.test import APIClient


@pytest.mark.usefixtures("seeded")
def test_returns_employee_with_employment_history(api: APIClient) -> None:
    response = api.get("/hr/v1/employees/27451863")

    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Wanjiku Njoki Kamau"
    assert body["employments"][0]["employer_code"] == "KEMSA"
    assert body["employments"][0]["job_group"] == "M"


@pytest.mark.usefixtures("seeded")
def test_person_without_public_employment_is_not_found(api: APIClient) -> None:
    # Peter Kamau is in IPRS but works in the private sector.
    assert api.get("/hr/v1/employees/24718355").status_code == 404


@pytest.mark.usefixtures("seeded")
def test_lists_kemsa_suppliers_including_wanjikus_company(api: APIClient) -> None:
    response = api.get("/hr/v1/employers/KEMSA/suppliers")

    assert response.status_code == 200
    assert response.json() == {
        "employer_code": "KEMSA",
        "registration_numbers": ["PVT-9XYZ2L4Q"],
    }


@pytest.mark.usefixtures("seeded")
def test_unknown_employer_has_no_suppliers(api: APIClient) -> None:
    response = api.get("/hr/v1/employers/UNKNOWN/suppliers")

    assert response.status_code == 200
    assert response.json() == {"employer_code": "UNKNOWN", "registration_numbers": []}
