from django.db import models


class Company(models.Model):
    """A company on the Business Registration Service register."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        DISSOLVED = "dissolved", "Dissolved"

    registration_number = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices)
    registered_on = models.DateField()

    class Meta:
        ordering = ["registration_number"]
        verbose_name_plural = "companies"

    def __str__(self) -> str:
        return f"{self.registration_number} {self.name}"


class Directorship(models.Model):
    """A person's role in a company: director, shareholder or both."""

    class Role(models.TextChoices):
        DIRECTOR = "director", "Director"
        SHAREHOLDER = "shareholder", "Shareholder"
        DIRECTOR_SHAREHOLDER = "director_shareholder", "Director and shareholder"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="directorships")
    id_number = models.CharField(max_length=10, db_index=True)
    full_name = models.CharField(max_length=200)
    role = models.CharField(max_length=25, choices=Role.choices)
    shares = models.PositiveIntegerField(default=0)
    appointed_on = models.DateField()

    class Meta:
        ordering = ["company__registration_number", "id_number"]
        constraints = [
            models.UniqueConstraint(fields=["company", "id_number"], name="brs_unique_person_role")
        ]

    def __str__(self) -> str:
        return f"{self.id_number} in {self.company_id}"
