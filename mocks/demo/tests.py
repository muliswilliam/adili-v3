import pytest

from demo.fixtures import load_roster_rows, parse_name
from demo.seed import seed_demo
from hr.models import EmployerSupplier, Employment
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


@pytest.mark.django_db
def test_seed_creates_iprs_and_hr_from_roster_files() -> None:
    seed_demo()
    rows = load_roster_rows()

    ids = [row.national_id for row in rows]
    assert Person.objects.filter(id_number__in=ids).count() == len(rows)
    assert Employment.objects.filter(
        personal_number__in=[row.personnel_file_number for row in rows]
    ).count() == len(rows)
    assert Person.objects.filter(id_number="40731125").exists()
    assert Person.objects.filter(id_number="24718355").exists()


def test_parse_name_splits_middle_names() -> None:
    assert parse_name("Wanjiku Njoki Kamau") == ("Wanjiku", "Njoki", "Kamau")
    assert parse_name("Jane Doe") == ("Jane", "", "Doe")
