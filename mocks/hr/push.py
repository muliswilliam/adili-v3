"""Push the demo Commission's roster to the directory (spec 02 #54)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from demo.seed import EMPLOYMENTS, PEOPLE, full_name

DEFAULT_DIRECTORY_URL = "http://localhost:4001"
DEFAULT_TOKEN = "demo-psc-roster-write"
DEFAULT_COMMISSION = "psc"
BATCH_IDEMPOTENCY_KEY = "hr-demo-psc-batch-1"
EXIT_IDEMPOTENCY_KEY = "hr-demo-psc-exit-1"

# Planted exit so the demo can show an HR-confirmed departure without
# taking Wanjiku or the other onboardable officers off the roster.
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
    "email": "grace.muthoni@psc.go.ke",
    "phone": "+254712339001",
}


@dataclass(frozen=True)
class HttpResult:
    status: int
    body: Any
    url: str


def directory_url() -> str:
    return os.environ.get("DIRECTORY_API_URL", DEFAULT_DIRECTORY_URL).rstrip("/")


def directory_token() -> str:
    return os.environ.get("DIRECTORY_HR_TOKEN", DEFAULT_TOKEN)


def commission_slug() -> str:
    return os.environ.get("DIRECTORY_COMMISSION", DEFAULT_COMMISSION)


def demo_batch_rows() -> list[dict[str, str]]:
    people = {person.id_number: person for person in PEOPLE}
    rows: list[dict[str, str]] = []
    for id_number, personal, employer, employer_name, title, group, appointed in EMPLOYMENTS:
        person = people[id_number]
        rows.append(
            {
                "personnelFileNumber": personal,
                "fullName": full_name(person),
                "nationalId": id_number,
                "designation": title,
                "jobGroup": group,
                "reportingEntity": employer_name,
                "appointmentDate": appointed.isoformat(),
                "email": (
                    f"{person.first_name.lower()}.{person.last_name.lower()}"
                    f"@{employer.lower()}.go.ke"
                ),
                "phone": f"+254712{id_number[-6:]}",
            }
        )
    rows.append(dict(EXIT_ROW))
    return rows


def batch_payload() -> dict[str, object]:
    return {"channel": "api", "rows": demo_batch_rows()}


def exit_payload() -> dict[str, str]:
    return {"exitDate": EXIT_DATE.isoformat()}


def post_json(url: str, body: object, headers: dict[str, str], timeout: float = 10) -> HttpResult:
    request = Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={**headers, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            parsed: Any = json.loads(raw) if raw else {}
            return HttpResult(response.status, parsed, url)
    except HTTPError as error:
        raw = error.read()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"detail": raw.decode("utf-8", errors="replace")}
        return HttpResult(error.code, parsed, url)
    except URLError as error:
        raise ConnectionError(f"Directory not reachable at {url}: {error.reason}") from error


def _headers(idempotency_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {directory_token()}",
        "Idempotency-Key": idempotency_key,
    }


def push_demo_roster(*, dry_run: bool = False) -> list[HttpResult]:
    """POST a roster batch for the demo Commission, then record one exit."""
    base = directory_url()
    slug = commission_slug()
    import_url = f"{base}/v1/commissions/{slug}/roster/imports"
    exit_url = (
        f"{base}/v1/commissions/{slug}/roster/records/{quote(EXIT_FILE_NUMBER, safe='')}/exit"
    )
    if dry_run:
        return [
            HttpResult(0, {"url": import_url, "body": batch_payload()}, import_url),
            HttpResult(0, {"url": exit_url, "body": exit_payload()}, exit_url),
        ]
    results = [
        post_json(import_url, batch_payload(), _headers(BATCH_IDEMPOTENCY_KEY)),
        post_json(exit_url, exit_payload(), _headers(EXIT_IDEMPOTENCY_KEY)),
    ]
    return results
