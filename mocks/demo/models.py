from django.db import models


class RegistryState(models.Model):
    """Runtime pause toggle for one registry mock. No row means the env default applies."""

    system = models.CharField(max_length=20, primary_key=True)
    paused = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.system} {'paused' if self.paused else 'running'}"
