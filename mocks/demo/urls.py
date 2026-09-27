from django.urls import path

from demo.views import pause_registry, registry_status, resume_registry

urlpatterns = [
    path("demo/registries/<str:system>/pause", pause_registry, name="demo-registry-pause"),
    path("demo/registries/<str:system>/resume", resume_registry, name="demo-registry-resume"),
    path("demo/registries/<str:system>", registry_status, name="demo-registry-status"),
]
