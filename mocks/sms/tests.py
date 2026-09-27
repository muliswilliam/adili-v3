import uuid

import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_accepts_and_lists_message(api: APIClient) -> None:
    sent = api.post(
        "/sms",
        {"to": "+254712345678", "message": "Your declaration DCB-PSC-2027-0012345-K was received."},
        format="json",
    )

    assert sent.status_code == 201
    assert sent.json()["sender_id"] == "ADILI"
    listed = api.get("/sms", {"to": "+254712345678"}).json()
    assert [m["message_id"] for m in listed] == [sent.json()["message_id"]]


@pytest.mark.django_db
def test_rejects_non_kenyan_number(api: APIClient) -> None:
    response = api.post("/sms", {"to": "0712345678", "message": "hi"}, format="json")

    assert response.status_code == 400


@pytest.mark.django_db
def test_unknown_message_is_not_found(api: APIClient) -> None:
    assert api.get(f"/sms/{uuid.uuid4()}").status_code == 404


@pytest.mark.django_db
def test_inbox_page_lists_otp(api: APIClient) -> None:
    api.post(
        "/sms",
        {
            "to": "+254712000001",
            "message": "Your Adili code is 123456. If you did not request this, ignore it.",
        },
        format="json",
    )

    page = api.get("/sms/inbox", {"to": "+254712000001"})
    assert page.status_code == 200
    assert b"123456" in page.content
    assert b"SMS inbox" in page.content

    otp = api.get("/sms/otp", {"to": "+254712000001"})
    assert otp.status_code == 200
    assert otp.json()["code"] == "123456"


@pytest.mark.django_db
def test_otp_endpoint_requires_to(api: APIClient) -> None:
    assert api.get("/sms/otp").status_code == 400


@pytest.mark.django_db
def test_otp_endpoint_is_not_found_without_a_code(api: APIClient) -> None:
    api.post("/sms", {"to": "+254712000001", "message": "No code in this text."}, format="json")
    assert api.get("/sms/otp", {"to": "+254712000001"}).status_code == 404


@pytest.mark.django_db
def test_failure_header_blocks_send(api: APIClient) -> None:
    response = api.post(
        "/sms",
        {"to": "+254712000001", "message": "Your Adili code is 654321."},
        format="json",
        headers={"X-Mock-Failure": "unavailable"},
    )
    assert response.status_code == 503
    assert api.get("/sms", {"to": "+254712000001"}).json() == []
