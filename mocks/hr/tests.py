import pytest
from rest_framework.test import APIClient

from demo.fixtures import load_roster_rows
from hr.push import (
    EXIT_FILE_NUMBER,
    HttpResult,
    batch_payload,
    demo_batch_rows,
    exit_payload,
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


def test_push_roster_posts_batch_then_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, object]] = []

    def fake_post(
        url: str, body: object, headers: dict[str, str], timeout: float = 10
    ) -> HttpResult:
        calls.append((url, body))
        if url.endswith("/roster/imports"):
            return HttpResult(202, {"id": "import-1", "state": "pending"}, url)
        return HttpResult(200, {"state": "exited"}, url)

    monkeypatch.setattr("hr.push.post_json", fake_post)
    results = push_demo_roster()

    assert [result.status for result in results] == [202, 200]
    assert calls[0][0].endswith("/v1/commissions/psc/roster/imports")
    payload = calls[0][1]
    assert isinstance(payload, dict)
    assert payload["channel"] == "api"
    assert len(payload["rows"]) >= 2
    assert "PSC%2F2019%2F0888" in calls[1][0]
    assert calls[1][1] == {"exitDate": "2026-08-31"}


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
