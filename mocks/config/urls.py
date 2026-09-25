from django.urls import include, path

from config.health import health

# Each system owns its full path prefix (e.g. `iprs/v1/...`) so its URLconf can be
# exported on its own as an OpenAPI contract (see `manage.py export_contracts`).
SYSTEM_URLCONFS = [
    "iprs.urls",
    "kra.urls",
    "ntsa.urls",
    "brs.urls",
    "ardhisasa.urls",
    "hr.urls",
    "payroll.urls",
    "icms.urls",
    "sms.urls",
]

urlpatterns = [
    path("health", health, name="health"),
    *[path("", include(urlconf)) for urlconf in SYSTEM_URLCONFS],
]
