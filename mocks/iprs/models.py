from django.db import models


class Person(models.Model):
    """A registered Kenyan citizen or resident, keyed by national ID number."""

    class Sex(models.TextChoices):
        FEMALE = "F", "Female"
        MALE = "M", "Male"

    id_number = models.CharField(max_length=10, unique=True)
    first_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100)
    date_of_birth = models.DateField()
    sex = models.CharField(max_length=1, choices=Sex.choices)
    place_of_birth = models.CharField(max_length=100)
    date_of_issue = models.DateField()

    class Meta:
        ordering = ["id_number"]

    def __str__(self) -> str:
        return f"{self.id_number} {self.first_name} {self.last_name}"
