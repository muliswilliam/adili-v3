"""Fault injection for the 07b adapter kit: latency, failures, registry pause and rate limits.

Every simulated system gets latency and failure flags (env defaults, per-request headers).
The four registries (KRA, NTSA, BRS, ArdhiSasa) also get pause controls and `RateLimit-*`
headers with a per-minute limit.

Pause state lives in the database so it holds across dev-server reloads and gunicorn
workers; `MOCK_<REGISTRY>_PAUSED` is only the default until someone pauses or resumes.
Rate-limit counters are in memory per process: they reset on reload and each gunicorn
worker counts separately, which is fine for a mock.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse

from demo.models import RegistryState

FAILURE_TIMEOUT = "timeout"
FAILURE_UNAVAILABLE = "unavailable"
FAILURE_ERROR = "error"
KNOWN_FAILURES = {FAILURE_TIMEOUT, FAILURE_UNAVAILABLE, FAILURE_ERROR}

REGISTRIES = ("kra", "ntsa", "brs", "ardhisasa")
SYSTEMS = ("iprs", "sms", *REGISTRIES)

_SKIP_PREFIXES = ("/health", "/sms/inbox", "/sms/otp")

_lock = threading.Lock()
_hits: dict[tuple[str, int], int] = {}


def _now() -> float:
    return time.time()


def _system_for(path: str) -> str | None:
    if path.startswith(_SKIP_PREFIXES):
        return None
    if path == "/sms":
        return "sms"
    for system in SYSTEMS:
        if path.startswith(f"/{system}/"):
            return system
    return None


def _failure_header(request: HttpRequest) -> str:
    """Header values are case-insensitive, matching how the env flags are parsed."""
    return request.headers.get("X-Mock-Failure", "").strip().lower()


def _int_header(request: HttpRequest, name: str) -> int | None:
    raw = request.headers.get(name)
    if raw is None or raw == "":
        return None
    try:
        return max(0, int(raw))
    except ValueError:
        return None


# Registry pause controls


def _require_registry(system: str) -> None:
    if system not in REGISTRIES:
        raise ValueError(f"Unknown registry {system}")


def pause(system: str) -> None:
    _require_registry(system)
    RegistryState.objects.update_or_create(system=system, defaults={"paused": True})


def resume(system: str) -> None:
    _require_registry(system)
    RegistryState.objects.update_or_create(system=system, defaults={"paused": False})


def is_paused(system: str) -> bool:
    _require_registry(system)
    state = RegistryState.objects.filter(system=system).first()
    if state is None:
        return system in settings.MOCK_REGISTRY_PAUSED
    return state.paused


# Registry rate limits


def reset_rate_limits() -> None:
    """Clear the in-memory hit counters. Tests call this between cases."""
    with _lock:
        _hits.clear()


def _hit(system: str, now: float) -> int:
    bucket = int(now // 60)
    key = (system, bucket)
    with _lock:
        for stale in [item for item in _hits if item[1] < bucket]:
            del _hits[stale]
        _hits[key] = _hits.get(key, 0) + 1
        return _hits[key]


def _rate_limit_headers(system: str, used: int, now: float) -> dict[str, str]:
    limit = settings.MOCK_REGISTRY_RATE_LIMIT
    window_ends_at = (int(now // 60) + 1) * 60
    return {
        "RateLimit-Limit": str(limit),
        "RateLimit-Remaining": str(max(0, limit - used)),
        # Delta seconds until the window resets, not a timestamp: clients wait this long.
        "RateLimit-Reset": str(max(1, math.ceil(window_ends_at - now))),
        "X-Mock-System": system,
    }


# Responses


def _problem(title: str, status: int, detail: str) -> JsonResponse:
    return JsonResponse({"title": title, "status": status, "detail": detail}, status=status)


def _failure_response(failure: str, detail: str | None = None) -> JsonResponse:
    if failure == FAILURE_TIMEOUT:
        return _problem("Gateway Timeout", 504, detail or "Injected timeout")
    if failure == FAILURE_UNAVAILABLE:
        return _problem("Service Unavailable", 503, detail or "Injected outage")
    return _problem("Internal Server Error", 500, detail or "Injected error")


class FaultInjectionMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        system = _system_for(request.path)
        if system is None:
            return self.get_response(request)

        latency_ms = _int_header(request, "X-Mock-Latency-Ms")
        if latency_ms is None:
            latency_ms = settings.MOCK_LATENCIES_MS.get(system, 0)
        if latency_ms:
            time.sleep(latency_ms / 1000)

        failure = _failure_header(request) or settings.MOCK_FAILURES.get(system, "")
        if system not in REGISTRIES:
            if failure in KNOWN_FAILURES:
                return _failure_response(failure)
            return self.get_response(request)

        now = _now()
        used = _hit(system, now)
        headers = _rate_limit_headers(system, used, now)
        response: HttpResponse
        if failure in KNOWN_FAILURES:
            response = _failure_response(failure)
        elif is_paused(system):
            response = _failure_response(FAILURE_UNAVAILABLE, "Registry paused")
        elif (
            request.headers.get("X-Mock-Rate-Limited", "") == "1"
            or used > settings.MOCK_REGISTRY_RATE_LIMIT
        ):
            response = _problem("Too Many Requests", 429, "Rate limit exceeded")
        else:
            response = self.get_response(request)
        for key, value in headers.items():
            response[key] = value
        return response
