"""Pause, failure and rate-limit controls for the 07b registry mocks."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse

SYSTEMS = ("kra", "ntsa", "brs", "ardhisasa")
FAILURE_TIMEOUT = "timeout"
FAILURE_UNAVAILABLE = "unavailable"
FAILURE_ERROR = "error"
KNOWN_FAILURES = {FAILURE_TIMEOUT, FAILURE_UNAVAILABLE, FAILURE_ERROR}

_lock = threading.Lock()
_paused: set[str] = set()
_hits: dict[tuple[str, int], int] = {}


def reset() -> None:
    """Clear pause and rate-limit state. Tests call this between cases."""
    with _lock:
        _paused.clear()
        _hits.clear()


def pause(system: str) -> None:
    _require(system)
    with _lock:
        _paused.add(system)


def resume(system: str) -> None:
    _require(system)
    with _lock:
        _paused.discard(system)


def is_paused(system: str) -> bool:
    _require(system)
    if system in settings.MOCK_REGISTRY_PAUSED:
        return True
    with _lock:
        return system in _paused


def _require(system: str) -> None:
    if system not in SYSTEMS:
        raise ValueError(f"Unknown registry {system}")


def _system_for(path: str) -> str | None:
    for system in SYSTEMS:
        if path.startswith(f"/{system}/"):
            return system
    return None


def _minute_bucket() -> int:
    return int(time.time() // 60)


def _hit(system: str) -> int:
    bucket = _minute_bucket()
    key = (system, bucket)
    with _lock:
        stale = [item for item in _hits if item[1] < bucket]
        for item in stale:
            del _hits[item]
        _hits[key] = _hits.get(key, 0) + 1
        return _hits[key]


def _headers(system: str, used: int) -> dict[str, str]:
    limit = settings.MOCK_REGISTRY_RATE_LIMIT
    remaining = max(0, limit - used)
    reset_at = (_minute_bucket() + 1) * 60
    return {
        "RateLimit-Limit": str(limit),
        "RateLimit-Remaining": str(remaining),
        "RateLimit-Reset": str(reset_at),
        "X-Mock-System": system,
    }


def _failure_response(failure: str) -> JsonResponse:
    if failure == FAILURE_TIMEOUT:
        return JsonResponse(
            {"title": "Gateway Timeout", "status": 504, "detail": "Injected timeout"},
            status=504,
        )
    if failure == FAILURE_UNAVAILABLE:
        return JsonResponse(
            {"title": "Service Unavailable", "status": 503, "detail": "Registry paused"},
            status=503,
        )
    return JsonResponse(
        {"title": "Internal Server Error", "status": 500, "detail": "Injected error"},
        status=500,
    )


class RegistryControlMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        system = _system_for(request.path)
        if system is None:
            return self.get_response(request)

        used = _hit(system)
        headers = _headers(system, used)
        failure = request.headers.get("X-Mock-Failure", "").strip().lower()
        force_limited = request.headers.get("X-Mock-Rate-Limited", "") == "1"
        over_limit = used > settings.MOCK_REGISTRY_RATE_LIMIT

        if is_paused(system) and failure not in KNOWN_FAILURES:
            failure = FAILURE_UNAVAILABLE
        if failure in KNOWN_FAILURES:
            response: HttpResponse = _failure_response(failure)
            for key, value in headers.items():
                response[key] = value
            return response
        if force_limited or over_limit:
            response = JsonResponse(
                {"title": "Too Many Requests", "status": 429, "detail": "Rate limit exceeded"},
                status=429,
            )
            for key, value in headers.items():
                response[key] = value
            return response

        response = self.get_response(request)
        for key, value in headers.items():
            response[key] = value
        return response
