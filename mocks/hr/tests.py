import uuid

import pytest
from rest_framework.test import APIClient

from demo.fixtures import load_roster_rows
from hr.push import (
    EXIT_FILE_NUMBER,
    HttpResult,
    PushError,
    batch_payload,
    demo_batch_rows,
    exit_payload,
    idempotency_key,
    push_demo_roster,
)


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


def test_demo_batch_matches_directory_roster_rows() -> None:
    rows = demo_batch_rows()
    wanjiku = next(row for row in rows if row["nationalId"] == "27451863")
    assert wanjiku["personnelFileNumber"] == "KEMSA/2011/0457"
    assert wanjiku["fullName"] == "Wanjiku Njoki Kamau"
    assert wanjiku["phone"] == "+254712000001"
    assert wanjiku["email"] == "wanjiku.kamau@kemsa.go.ke"
    assert batch_payload()["channel"] == "api"
    assert any(row["personnelFileNumber"] == EXIT_FILE_NUMBER for row in rows)
    assert exit_payload() == {"exitDate": "2026-08-31"}


TOKEN_URL = "http://keycloak.test/realms/adili/protocol/openid-connect/token"


@pytest.fixture
def credential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIRECTORY_HR_CLIENT_ID", "roster-psc-0a1b2c3d")
    monkeypatch.setenv("DIRECTORY_HR_CLIENT_SECRET", "s3cret")
    monkeypatch.setenv("DIRECTORY_HR_TOKEN_URL", TOKEN_URL)


@pytest.mark.usefixtures("credential")
def test_push_roster_exchanges_the_credential_then_posts_batch_waits_and_exits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forms: list[tuple[str, dict[str, str]]] = []
    posts: list[tuple[str, object, dict[str, str]]] = []
    gets: list[str] = []
    states = iter(["processing", "completed"])

    def fake_form(url: str, form: dict[str, str], timeout: float = 10) -> HttpResult:
        forms.append((url, form))
        return HttpResult(200, {"access_token": "token-1", "token_type": "Bearer"}, url)

    def fake_post(
        url: str, body: object, headers: dict[str, str], timeout: float = 10
    ) -> HttpResult:
        posts.append((url, body, headers))
        if url.endswith("/roster/imports"):
            return HttpResult(202, {"id": "import-1", "state": "pending"}, url)
        return HttpResult(200, {"state": "exited"}, url)

    def fake_get(url: str, headers: dict[str, str], timeout: float = 10) -> HttpResult:
        gets.append(url)
        assert headers["Authorization"] == "Bearer token-1"
        return HttpResult(200, {"id": "import-1", "state": next(states)}, url)

    monkeypatch.setattr("hr.push.post_form", fake_form)
    monkeypatch.setattr("hr.push.post_json", fake_post)
    monkeypatch.setattr("hr.push.get_json", fake_get)
    monkeypatch.setattr("hr.push.POLL_INTERVAL_SECONDS", 0)
    results = push_demo_roster()

    assert forms == [
        (
            TOKEN_URL,
            {
                "grant_type": "client_credentials",
                "client_id": "roster-psc-0a1b2c3d",
                "client_secret": "s3cret",
                "scope": "roster:write",
            },
        )
    ]
    assert [result.status for result in results] == [202, 200, 200]
    batch_url, payload, batch_headers = posts[0]
    assert batch_url.endswith("/v1/commissions/psc/roster/imports")
    assert batch_headers["Authorization"] == "Bearer token-1"
    assert isinstance(payload, dict)
    assert payload["channel"] == "api"
    assert len(payload["rows"]) >= 2
    assert gets == [f"{batch_url}/import-1", f"{batch_url}/import-1"]
    exit_url, exit_body, exit_headers = posts[1]
    assert "PSC%2F2019%2F0888" in exit_url
    assert exit_body == {"exitDate": "2026-08-31"}
    # Idempotency keys are UUIDs, the same for the same request on a re-run.
    for headers in (batch_headers, exit_headers):
        assert str(uuid.UUID(headers["Idempotency-Key"])) == headers["Idempotency-Key"]
    assert batch_headers["Idempotency-Key"] == idempotency_key("batch", batch_payload())
    assert batch_headers["Idempotency-Key"] != exit_headers["Idempotency-Key"]


@pytest.mark.usefixtures("credential")
def test_push_roster_stops_when_the_import_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[str] = []
    monkeypatch.setattr(
        "hr.push.post_form",
        lambda url, form, timeout=10: HttpResult(200, {"access_token": "t"}, url),
    )

    def fake_post(
        url: str, body: object, headers: dict[str, str], timeout: float = 10
    ) -> HttpResult:
        posted.append(url)
        return HttpResult(202, {"id": "import-1", "state": "pending"}, url)

    monkeypatch.setattr("hr.push.post_json", fake_post)
    monkeypatch.setattr(
        "hr.push.get_json",
        lambda url, headers, timeout=10: HttpResult(200, {"state": "failed"}, url),
    )
    results = push_demo_roster()

    assert [result.body["state"] for result in results] == ["pending", "failed"]
    assert len(posted) == 1


@pytest.mark.usefixtures("credential")
def test_push_roster_reports_a_refused_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "hr.push.post_form",
        lambda url, form, timeout=10: HttpResult(401, {"error": "invalid_client"}, url),
    )
    with pytest.raises(PushError, match="invalid_client"):
        push_demo_roster()


def test_push_roster_needs_the_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DIRECTORY_HR_CLIENT_ID", raising=False)
    monkeypatch.delenv("DIRECTORY_HR_CLIENT_SECRET", raising=False)
    with pytest.raises(PushError, match="DIRECTORY_HR_CLIENT_ID"):
        push_demo_roster()


def test_push_roster_dry_run_does_not_call_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "hr.push.post_json",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("should not call")),
    )
    results = push_demo_roster(dry_run=True)
    assert [result.status for result in results] == [0, 0]
    assert results[0].body["body"]["channel"] == "api"


def test_demo_batch_uses_roster_fixture_contacts() -> None:
    fixture = {row.national_id: (row.email, row.phone) for row in load_roster_rows("psc")}
    batch = {
        row["nationalId"]: (row["email"], row["phone"])
        for row in demo_batch_rows()
        if row["personnelFileNumber"] != EXIT_FILE_NUMBER
    }
    assert batch == fixture


def test_unknown_commission_has_no_demo_roster(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIRECTORY_COMMISSION", "nope")
    with pytest.raises(FileNotFoundError):
        demo_batch_rows()
