import pytest
from django.utils import timezone
from rest_framework.test import APIClient

REFERRAL = {
    "referral_reference": "RFL-PSC-2029-0000007-3",
    "id_number": "22607781",
    "full_name": "Kiprono Kibet Chebet",
    "referring_commission": "PSC",
    "grounds": "Non-compliance in two consecutive declaration cycles (Reg 20(2))",
}


@pytest.mark.django_db
def test_registers_referral_with_sequential_case_number(api: APIClient) -> None:
    year = timezone.localdate().year
    first = api.post("/icms/v1/referrals", REFERRAL, format="json")
    second = api.post(
        "/icms/v1/referrals",
        {**REFERRAL, "referral_reference": "RFL-PSC-2029-0000008-1"},
        format="json",
    )

    assert first.status_code == 201
    assert first.json()["case_number"] == f"EACC/ICMS/{year}/000001"
    assert second.json()["case_number"] == f"EACC/ICMS/{year}/000002"


@pytest.mark.django_db
def test_resubmission_returns_original_case(api: APIClient) -> None:
    first = api.post("/icms/v1/referrals", REFERRAL, format="json")
    second = api.post("/icms/v1/referrals", REFERRAL, format="json")

    assert second.status_code == 200
    assert second.json()["case_number"] == first.json()["case_number"]


@pytest.mark.django_db
def test_returns_case_by_number(api: APIClient) -> None:
    case_number = api.post("/icms/v1/referrals", REFERRAL, format="json").json()["case_number"]

    response = api.get(f"/icms/v1/referrals/{case_number}")

    assert response.status_code == 200
    assert response.json()["referral_reference"] == REFERRAL["referral_reference"]


@pytest.mark.django_db
def test_unknown_case_is_not_found(api: APIClient) -> None:
    assert api.get("/icms/v1/referrals/EACC/ICMS/1999/000001").status_code == 404


@pytest.mark.django_db
def test_status_page_shows_case_number(api: APIClient) -> None:
    created = api.post("/icms/v1/referrals", REFERRAL, format="json")
    page = api.get("/icms/status")

    assert page.status_code == 200
    assert b"ICMS referrals" in page.content
    assert REFERRAL["referral_reference"].encode() in page.content
    assert created.json()["case_number"].encode() in page.content
