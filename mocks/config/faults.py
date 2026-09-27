"""Latency and failure flags so the 07b adapter kit can exercise timeouts and errors."""

from __future__ import annotations

import time
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse

FAILURE_TIMEOUT = "timeout"
FAILURE_UNAVAILABLE = "unavailable"
FAILURE_ERROR = "error"
KNOWN_FAILURES = {FAILURE_TIMEOUT, FAILURE_UNAVAILABLE, FAILURE_ERROR}

_SKIP_PREFIXES = ("/health", "/sms/inbox", "/sms/otp")


def _system_for(path: str) -> str | None:
    if path.startswith(_SKIP_PREFIXES):
        return None
    if path.startswith("/iprs/"):
        return "iprs"
    if path == "/sms" or path.startswith("/sms/"):
        return "sms"
    return None


def _int_header(request: HttpRequest, name: str) -> int | None:
    raw = request.headers.get(name)
    if raw is None or raw == "":
        return None
    try:
        return max(0, int(raw))
    except ValueError:
        return None


class FaultInjectionMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        system = _system_for(request.path)
        if system is None:
            return self.get_response(request)

        failures = settings.MOCK_FAILURES
        latencies = settings.MOCK_LATENCIES_MS
        failure = request.headers.get("X-Mock-Failure") or failures.get(system) or ""
        latency_ms = _int_header(request, "X-Mock-Latency-Ms")
        if latency_ms is None:
            latency_ms = latencies.get(system, 0)

        if latency_ms:
            time.sleep(latency_ms / 1000)

        if failure in KNOWN_FAILURES:
            return _failure_response(failure)
        return self.get_response(request)


def _failure_response(failure: str) -> JsonResponse:
    if failure == FAILURE_TIMEOUT:
        return JsonResponse(
            {"title": "Gateway Timeout", "status": 504, "detail": "Injected timeout"},
            status=504,
        )
    if failure == FAILURE_UNAVAILABLE:
        return JsonResponse(
            {"title": "Service Unavailable", "status": 503, "detail": "Injected outage"},
            status=503,
        )
    return JsonResponse(
        {"title": "Internal Server Error", "status": 500, "detail": "Injected error"},
        status=500,
    )
