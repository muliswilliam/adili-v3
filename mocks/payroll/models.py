import uuid

from django.db import models


class Instruction(models.Model):
    """A payroll instruction from a responsible Commission, e.g. salary stoppage."""

    class Action(models.TextChoices):
        STOP_SALARY = "stop_salary", "Stop salary pending compliance"
        RESUME_SALARY = "resume_salary", "Resume salary"

    class Status(models.TextChoices):
        ACCEPTED = "accepted", "Accepted"

    payroll_reference = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    # The platform's reference (ADM-...) makes submissions idempotent.
    instruction_reference = models.CharField(max_length=40, unique=True)
    employer_code = models.CharField(max_length=20)
    personal_number = models.CharField(max_length=20)
    id_number = models.CharField(max_length=10)
    action = models.CharField(max_length=20, choices=Action.choices)
    reason = models.TextField()
    effective_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACCEPTED)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at"]

    def __str__(self) -> str:
        return self.instruction_reference
