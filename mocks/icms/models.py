from django.db import connection, models, transaction
from django.utils import timezone


class Referral(models.Model):
    """A non-compliance referral registered as a case in EACC's case management system."""

    class Status(models.TextChoices):
        REGISTERED = "registered", "Registered"

    case_number = models.CharField(max_length=30, unique=True, editable=False)
    # The platform's reference (RFL-...) makes submissions idempotent.
    referral_reference = models.CharField(max_length=40, unique=True)
    id_number = models.CharField(max_length=10)
    full_name = models.CharField(max_length=200)
    referring_commission = models.CharField(max_length=20)
    grounds = models.CharField(max_length=200)
    details = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.REGISTERED)
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-registered_at"]

    def __str__(self) -> str:
        return self.case_number

    def save(self, *args: object, **kwargs: object) -> None:
        if not self.case_number:
            with transaction.atomic():
                # Serialises numbering across concurrent requests until the transaction ends.
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_xact_lock(hashtext('icms_case_number'))")
                year = timezone.localdate().year
                count = Referral.objects.filter(
                    case_number__startswith=f"EACC/ICMS/{year}/"
                ).count()
                self.case_number = f"EACC/ICMS/{year}/{count + 1:06d}"
                super().save(*args, **kwargs)  # type: ignore[arg-type]
            return
        super().save(*args, **kwargs)  # type: ignore[arg-type]
