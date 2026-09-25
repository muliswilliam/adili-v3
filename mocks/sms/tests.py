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
