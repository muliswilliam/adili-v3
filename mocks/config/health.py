from django.db import connection
from django.http import HttpRequest, JsonResponse


def health(_request: HttpRequest) -> JsonResponse:
    """Readiness probe used by the integration-gateway: up only when the database answers."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception as error:
        return JsonResponse({"status": "down", "error": str(error)}, status=503)
    return JsonResponse({"status": "up"})
