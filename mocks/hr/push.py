"""Push the demo Commission's roster to the directory as its HR system would (spec 02 #54).

The HR system authenticates with the API credential a reporting officer created in the console
(client id and secret, OAuth2 client credentials against Keycloak), pushes the roster as one
batch, waits for the import's report, then records one exit by personnel file number.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from demo.fixtures import load_roster_rows

DEFAULT_DIRECTORY_URL = "http://localhost:4001"
DEFAULT_TOKEN_URL = "http://localhost:8080/realms/adili/protocol/openid-connect/token"
DEFAULT_COMMISSION = "psc"
ROSTER_SCOPE = "roster:write"

# Idempotency keys are UUIDs derived from the request, so pushing the same roster again replays
# the first response instead of importing twice, and a changed roster starts a new import.
IDEMPOTENCY_NAMESPACE = uuid.UUID("5b0c8f4e-4d6a-4c55-9a39-2f1f0a6e2b71")

# How long to wait for the batch's import to end before recording the exit.
IMPORT_TIMEOUT_SECONDS = 60.0
POLL_INTERVAL_SECONDS = 0.5

# Planted exit so the demo can show an HR-confirmed departure without
# taking Wanjiku or the other onboardable officers off the roster. Not in the
# roster fixtures on purpose: seeding would make her an active IPRS/HR officer.
EXIT_FILE_NUMBER = "PSC/2019/0888"
EXIT_DATE = date(2026, 8, 31)
EXIT_ROW = {
    "personnelFileNumber": EXIT_FILE_NUMBER,
    "fullName": "Grace Wanjiru Muthoni",
    "nationalId": "33900112",
    "designation": "Records Officer",
    "jobGroup": "H",
    "reportingEntity": "Public Service Commission",
    "appointmentDate": "2019-06-01",
    "email": "grace.muthoni@publicservice.go.ke",
    "phone": "+254712000099",
}


class PushError(Exception):
    """The push cannot go on: no credential, or the token endpoint or directory refused."""


@dataclass(frozen=True)
class HttpResult:
    status: int
    body: Any
    url: str


def directory_url() -> str:
    return os.environ.get("DIRECTORY_API_URL", DEFAULT_DIRECTORY_URL).rstrip("/")


def token_url() -> str:
    return os.environ.get("DIRECTORY_HR_TOKEN_URL", DEFAULT_TOKEN_URL)


def client_credentials() -> tuple[str, str]:
    """The Commission's API credential, as created in the console (Roster, API access)."""
    client_id = os.environ.get("DIRECTORY_HR_CLIENT_ID", "")
    secret = os.environ.get("DIRECTORY_HR_CLIENT_SECRET", "")
    if not client_id or not secret:
        raise PushError(
            "Set DIRECTORY_HR_CLIENT_ID and DIRECTORY_HR_CLIENT_SECRET to the API credential "
            "created in the console (Roster, API access)."
        )
    return client_id, secret


def commission_slug() -> str:
    return os.environ.get("DIRECTORY_COMMISSION", DEFAULT_COMMISSION)


def demo_batch_rows() -> list[dict[str, str]]:
    """The Commission's roster fixture as directory RosterRowInput rows, plus the planted exit.

    Contact details come straight from the fixture so onboarding OTPs land in the SMS
    inbox under the same numbers IPRS and HR were seeded with.
    """
    rows = [
        {
            "personnelFileNumber": row.personnel_file_number,
            "fullName": row.full_name,
            "nationalId": row.national_id,
            "designation": row.designation,
            "jobGroup": row.job_group,
            "reportingEntity": row.reporting_entity,
            "appointmentDate": row.appointment_date.isoformat(),
            "email": row.email,
            "phone": row.phone,
        }
        for row in load_roster_rows(commission_slug())
    ]
    rows.append(dict(EXIT_ROW))
    return rows


def batch_payload() -> dict[str, object]:
    return {"channel": "api", "rows": demo_batch_rows()}


def exit_payload() -> dict[str, str]:
    return {"exitDate": EXIT_DATE.isoformat()}


def idempotency_key(purpose: str, body: object) -> str:
    """A UUID that is the same for the same request, e.g. a re-run of the demo push."""
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    return str(uuid.uuid5(IDEMPOTENCY_NAMESPACE, f"{commission_slug()}:{purpose}:{digest}"))


def _send(request: Request, timeout: float) -> HttpResult:
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            parsed: Any = json.loads(raw) if raw else {}
            return HttpResult(response.status, parsed, request.full_url)
    except HTTPError as error:
        raw = error.read()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"detail": raw.decode("utf-8", errors="replace")}
        return HttpResult(error.code, parsed, request.full_url)
    except URLError as error:
        raise ConnectionError(f"Not reachable at {request.full_url}: {error.reason}") from error


def post_json(url: str, body: object, headers: dict[str, str], timeout: float = 10) -> HttpResult:
    request = Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={**headers, "Content-Type": "application/json", "Accept": "application/json"},
    )
    return _send(request, timeout)


def get_json(url: str, headers: dict[str, str], timeout: float = 10) -> HttpResult:
    request = Request(url, method="GET", headers={**headers, "Accept": "application/json"})
    return _send(request, timeout)


def post_form(url: str, form: dict[str, str], timeout: float = 10) -> HttpResult:
    request = Request(
        url,
        data=urlencode(form).encode(),
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    )
    return _send(request, timeout)


def fetch_access_token() -> str:
    """Exchanges the API credential for an access token (OAuth2 client credentials)."""
    client_id, secret = client_credentials()
    result = post_form(
        token_url(),
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": secret,
            "scope": ROSTER_SCOPE,
        },
    )
    token = result.body.get("access_token") if isinstance(result.body, dict) else None
    if result.status != 200 or not isinstance(token, str):
        raise PushError(f"Token endpoint refused the credential ({result.status}): {result.body}")
    return token


def wait_for_import(
    url: str,
    headers: dict[str, str],
    *,
    timeout: float = IMPORT_TIMEOUT_SECONDS,
    interval: float = POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> HttpResult:
    """Polls the import until it has ended (or the directory answers with an error)."""
    deadline = time.monotonic() + timeout
    while True:
        result = get_json(url, headers)
        state = result.body.get("state") if isinstance(result.body, dict) else None
        if result.status != 200 or state in ("completed", "failed"):
            return result
        if time.monotonic() > deadline:
            raise PushError(f"Import still {state} after {timeout:.0f} s: {url}")
        sleep(interval)


def push_demo_roster(*, dry_run: bool = False) -> list[HttpResult]:
    """Push a roster batch for the demo Commission, wait for its report, then record one exit.

    Returns the batch's 202, the ended import (its report) and the exit's response; stops
    early when the directory refuses a step.
    """
    base = directory_url()
    slug = commission_slug()
    import_url = f"{base}/v1/commissions/{slug}/roster/imports"
    exit_url = (
        f"{base}/v1/commissions/{slug}/roster/records/{quote(EXIT_FILE_NUMBER, safe='')}/exit"
    )
    batch, exit_body = batch_payload(), exit_payload()
    if dry_run:
        return [
            HttpResult(0, {"url": import_url, "body": batch}, import_url),
            HttpResult(0, {"url": exit_url, "body": exit_body}, exit_url),
        ]

    auth = {"Authorization": f"Bearer {fetch_access_token()}"}
    started = post_json(
        import_url, batch, {**auth, "Idempotency-Key": idempotency_key("batch", batch)}
    )
    results = [started]
    import_id = started.body.get("id") if isinstance(started.body, dict) else None
    if started.status != 202 or not isinstance(import_id, str):
        return results
    report = wait_for_import(f"{import_url}/{import_id}", auth)
    results.append(report)
    if report.status != 200 or report.body.get("state") != "completed":
        return results
    results.append(
        post_json(
            exit_url, exit_body, {**auth, "Idempotency-Key": idempotency_key("exit", exit_body)}
        )
    )
    return results
