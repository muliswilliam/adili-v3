from django.urls import path

from demo.views import (
    demo_file,
    pause_registry,
    registry_status,
    resume_registry,
    synthetic_officers,
)

urlpatterns = [
    path("demo/synthetic-officers", synthetic_officers, name="demo-synthetic-officers"),
    path("demo/registries/<str:system>/pause", pause_registry, name="demo-registry-pause"),
    path("demo/registries/<str:system>/resume", resume_registry, name="demo-registry-resume"),
    path("demo/registries/<str:system>", registry_status, name="demo-registry-status"),
    path("demo/files/<str:name>", demo_file, name="demo-file"),
]
