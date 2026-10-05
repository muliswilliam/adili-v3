import json
import mimetypes
from datetime import date
from pathlib import Path

from django.http import FileResponse, HttpRequest, JsonResponse
from django.http.response import HttpResponseBase
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from config.faults import REGISTRIES, is_paused, pause, resume
from demo.rosters import OUTPUT_DIR as ROSTER_FILES_DIR
from demo.synthetic import CommissionSpec, as_json, generate, store

SAMPLE_FILES_DIR = Path(__file__).resolve().parent / "files"


def _system(system: str) -> str | None:
    if system not in REGISTRIES:
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


@csrf_exempt
@require_http_methods(["POST"])
def synthetic_officers(request: HttpRequest) -> JsonResponse:
    """Creates (or finds again) the demo's synthetic officers and returns them (#617)."""
    try:
        body = json.loads(request.body)
        seed = str(body["seed"])
        anchor = date.fromisoformat(body["anchor"])
        specs = [
            CommissionSpec(
                slug=str(c["slug"]),
                index=int(c["index"]),
                count=int(c["count"]),
                employer_code=str(c["employerCode"]),
                reporting_entity=str(c["reportingEntity"]),
                email_domain=str(c["emailDomain"]),
            )
            for c in body["commissions"]
        ]
        generated = {spec.slug: generate(seed, spec, anchor) for spec in specs}
    except (KeyError, TypeError, ValueError) as error:
        return JsonResponse({"detail": f"Invalid request: {error}"}, status=400)
    officers = [officer for group in generated.values() for officer in group]
    created = store(officers)
    return JsonResponse(
        {"created": created, "officers": {slug: as_json(o) for slug, o in generated.items()}}
    )


def _demo_file(name: str) -> Path | None:
    """A file the presenter uploads in the demo, by its exact name: a roster file or a sample."""
    for directory in (ROSTER_FILES_DIR, SAMPLE_FILES_DIR):
        for path in directory.iterdir():
            if path.is_file() and path.name == name and not name.startswith("."):
                return path
    return None


@require_http_methods(["GET"])
def demo_file(_request: HttpRequest, name: str) -> HttpResponseBase:
    """The demo's upload files as this deployment holds them (#679).

    Roster files are generated from the same fixtures the IPRS and HR mocks are seeded from, so a
    presenter who downloads them from the stack never imports a stale copy from another checkout.
    """
    path = _demo_file(name)
    if path is None:
        return JsonResponse({"detail": "Unknown demo file"}, status=404)
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path.open("rb"), content_type=content_type, as_attachment=True)
