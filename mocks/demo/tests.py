import pytest

from demo.seed import seed_demo
from hr.models import EmployerSupplier
from iprs.models import Person
from ntsa.models import Vehicle


@pytest.mark.django_db
def test_seeding_twice_creates_no_duplicates() -> None:
    seed_demo()
    counts = (
        Person.objects.count(),
        Vehicle.objects.count(),
        EmployerSupplier.objects.count(),
    )

    seed_demo()

    assert (
        Person.objects.count(),
        Vehicle.objects.count(),
        EmployerSupplier.objects.count(),
    ) == counts
    assert EmployerSupplier.objects.filter(
        employer_code="KEMSA", registration_number="PVT-9XYZ2L4Q"
    ).exists()
