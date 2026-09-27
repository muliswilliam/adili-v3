from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_http_methods

from config.registry_control import SYSTEMS, is_paused, pause, resume


def _system(system: str) -> str | None:
    if system not in SYSTEMS:
        return None
    return system


@require_http_methods(["POST"])
def pause_registry(_request: HttpRequest, system: str) -> JsonResponse:
    if _system(system) is None:
        return JsonResponse({"detail": "Unknown registry"}, status=404)
    pause(system)
    return JsonResponse({"system": system, "paused": True})


@require_http_methods(["POST"])
def resume_registry(_request: HttpRequest, system: str) -> JsonResponse:
    if _system(system) is None:
        return JsonResponse({"detail": "Unknown registry"}, status=404)
    resume(system)
    return JsonResponse({"system": system, "paused": False})


@require_http_methods(["GET"])
def registry_status(_request: HttpRequest, system: str) -> JsonResponse:
    if _system(system) is None:
        return JsonResponse({"detail": "Unknown registry"}, status=404)
    return JsonResponse({"system": system, "paused": is_paused(system)})
