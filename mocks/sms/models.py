import uuid

from django.db import models


class Message(models.Model):
    """An SMS accepted by the gateway. Nothing is sent; messages are kept for inspection."""

    class Status(models.TextChoices):
        DELIVERED = "delivered", "Delivered"

    message_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    to = models.CharField(max_length=16)
    sender_id = models.CharField(max_length=11, default="ADILI")
    message = models.TextField(max_length=918)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DELIVERED)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at"]

    def __str__(self) -> str:
        return f"{self.to}: {self.message[:30]}"
