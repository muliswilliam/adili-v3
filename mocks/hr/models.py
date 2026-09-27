from django.db import models


class Employment(models.Model):
    """A public service employment record from the government HR system (HRMIS)."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        EXITED = "exited", "Exited"

    id_number = models.CharField(max_length=10, db_index=True)
    personal_number = models.CharField(max_length=20)
    full_name = models.CharField(max_length=200)
    employer_code = models.CharField(max_length=20)
    employer_name = models.CharField(max_length=200)
    job_title = models.CharField(max_length=100)
    job_group = models.CharField(max_length=5)
    appointment_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices)
    exit_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["id_number", "-appointment_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["employer_code", "personal_number"], name="hr_unique_personal_number"
            )
        ]

    def __str__(self) -> str:
        return f"{self.personal_number} at {self.employer_code}"


class EmployerSupplier(models.Model):
    """A company on an employer's supplier list (used for the 07b conflict check)."""

    employer_code = models.CharField(max_length=20, db_index=True)
    registration_number = models.CharField(max_length=20)
    company_name = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["employer_code", "registration_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["employer_code", "registration_number"],
                name="hr_unique_employer_supplier",
            )
        ]

    def __str__(self) -> str:
        return f"{self.registration_number} supplies {self.employer_code}"
