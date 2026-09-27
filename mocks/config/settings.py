"""Settings for the simulated government systems. All configuration comes from the environment."""

import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("DJANGO_SECRET_KEY is required when DJANGO_DEBUG is not true")
    SECRET_KEY = "insecure-local-development-key"

ALLOWED_HOSTS = [host for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",") if host]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "drf_spectacular",
    "demo",
    "iprs",
    "kra",
    "ntsa",
    "brs",
    "ardhisasa",
    "hr",
    "payroll",
    "icms",
    "sms",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "config.faults.FaultInjectionMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {"autoescape": True},
    }
]


def _int_env(name: str, default: int = 0, minimum: int = 0) -> int:
    raw = os.environ.get(name, str(default)).strip()
    try:
        return max(minimum, int(raw))
    except ValueError:
        return default


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


# 07b adapter kit (config/faults.py): env defaults, overridden per request by
# X-Mock-Latency-Ms / X-Mock-Failure. Registries also take pause and rate-limit controls.
_MOCK_REGISTRIES = ("kra", "ntsa", "brs", "ardhisasa")
_MOCK_SYSTEMS = ("iprs", "sms", *_MOCK_REGISTRIES)
MOCK_LATENCIES_MS = {
    system: _int_env(f"MOCK_{system.upper()}_LATENCY_MS") for system in _MOCK_SYSTEMS
}
MOCK_FAILURES = {
    system: os.environ.get(f"MOCK_{system.upper()}_FAILURE", "").strip().lower()
    for system in _MOCK_SYSTEMS
}
# Initial pause state only; POST /demo/registries/<system>/pause|resume overrides it.
MOCK_REGISTRY_PAUSED = {
    system for system in _MOCK_REGISTRIES if _truthy_env(f"MOCK_{system.upper()}_PAUSED")
}
MOCK_REGISTRY_RATE_LIMIT = _int_env("MOCK_REGISTRY_RATE_LIMIT", 60, minimum=1)

DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get("DATABASE_URL", "postgres://mocks:mocks_dev@localhost:55432/mocks"),
        conn_max_age=60,
        conn_health_checks=True,
    )
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "en"
TIME_ZONE = "Africa/Nairobi"
USE_TZ = True

REST_FRAMEWORK = {
    # The mocks stand in for government APIs on a private network; no caller auth.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "OAS_VERSION": "3.1.0",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO").upper()},
}
