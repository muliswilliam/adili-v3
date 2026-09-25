from django.db import models


class Vehicle(models.Model):
    """A motor vehicle on the NTSA register and its current owner."""

    registration_number = models.CharField(max_length=10, unique=True)
    make = models.CharField(max_length=50)
    model = models.CharField(max_length=50)
    year_of_manufacture = models.PositiveSmallIntegerField()
    owner_id_number = models.CharField(max_length=10, db_index=True)
    registered_on = models.DateField()

    class Meta:
        ordering = ["registration_number"]

    def __str__(self) -> str:
        return self.registration_number
