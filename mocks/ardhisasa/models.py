from django.db import models


class Parcel(models.Model):
    """A registered land parcel and its proprietor."""

    class Tenure(models.TextChoices):
        FREEHOLD = "freehold", "Freehold"
        LEASEHOLD = "leasehold", "Leasehold"

    parcel_number = models.CharField(max_length=60, unique=True)
    county = models.CharField(max_length=50)
    area_hectares = models.DecimalField(max_digits=10, decimal_places=4)
    tenure = models.CharField(max_length=10, choices=Tenure.choices)
    owner_id_number = models.CharField(max_length=10, db_index=True)
    registered_on = models.DateField()

    class Meta:
        ordering = ["parcel_number"]

    def __str__(self) -> str:
        return self.parcel_number
