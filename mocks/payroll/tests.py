import pytest
from rest_framework.test import APIClient

INSTRUCTION = {
    "instruction_reference": "ADM-KEMSA-2027-0000042-7",
    "employer_code": "KEMSA",
    "personal_number": "KEMSA/2011/0457",
    "id_number": "27451863",
    "action": "stop_salary",
    "reason": "Failure to file the 2027 biennial declaration after a warning",
    "effective_date": "2028-03-01",
}


@pytest.mark.django_db
def test_accepts_instruction(api: APIClient) -> None:
    response = api.post("/payroll/v1/instructions", INSTRUCTION, format="json")

    assert response.status_code == 201
    assert response.json()["status"] == "accepted"
    assert response.json()["payroll_reference"]


@pytest.mark.django_db
def test_resubmission_returns_original_acknowledgement(api: APIClient) -> None:
    first = api.post("/payroll/v1/instructions", INSTRUCTION, format="json")
    second = api.post("/payroll/v1/instructions", INSTRUCTION, format="json")

    assert second.status_code == 200
    assert second.json()["payroll_reference"] == first.json()["payroll_reference"]


@pytest.mark.django_db
def test_rejects_unknown_action(api: APIClient) -> None:
    response = api.post(
        "/payroll/v1/instructions", {**INSTRUCTION, "action": "fire"}, format="json"
    )

    assert response.status_code == 400
    assert "action" in response.json()


@pytest.mark.django_db
def test_unknown_instruction_is_not_found(api: APIClient) -> None:
    assert api.get("/payroll/v1/instructions/ADM-NOPE").status_code == 404


@pytest.mark.django_db
def test_status_page_shows_acknowledgement(api: APIClient) -> None:
    created = api.post("/payroll/v1/instructions", INSTRUCTION, format="json")
    page = api.get("/payroll/status")

    assert page.status_code == 200
    assert b"Payroll instructions" in page.content
    assert INSTRUCTION["instruction_reference"].encode() in page.content
    assert created.json()["payroll_reference"].encode() in page.content
