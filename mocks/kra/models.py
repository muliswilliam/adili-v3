from django.db import models


class Taxpayer(models.Model):
    """An individual KRA PIN with its current tax compliance status."""

    class Compliance(models.TextChoices):
        COMPLIANT = "compliant", "Compliant"
        NON_COMPLIANT = "non_compliant", "Non-compliant"

    pin = models.CharField(max_length=11, unique=True)
    id_number = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=200)
    registered_on = models.DateField()
    compliance_status = models.CharField(max_length=20, choices=Compliance.choices)
    compliance_certificate_number = models.CharField(max_length=30, blank=True)
    compliance_valid_until = models.DateField(null=True, blank=True)
    annual_income_declared = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        ordering = ["pin"]

    def __str__(self) -> str:
        return f"{self.pin} {self.name}"
