import csv
import io

import pytest

from demo.fixtures import load_roster_rows, parse_name
from demo.rosters import (
    COMMISSIONS,
    PLANTED,
    TEMPLATE_COLUMNS,
    hr_rows,
    roster_csv,
    roster_path,
    roster_rows,
)
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


@pytest.mark.parametrize("commission", COMMISSIONS)
def test_committed_roster_files_are_generated(commission: str) -> None:
    # Regenerate with `pnpm --filter @adili/mocks roster:files`.
    assert roster_path(commission).read_bytes().decode("utf-8") == roster_csv(commission)


@pytest.mark.parametrize("commission", COMMISSIONS)
def test_roster_files_hold_the_hr_rows_and_the_planted_rows(commission: str) -> None:
    reader = csv.DictReader(io.StringIO(roster_csv(commission)))
    rows = list(reader)
    planted = [row.values for row in PLANTED[commission]]

    assert tuple(reader.fieldnames or ()) == TEMPLATE_COLUMNS
    assert [row for row in rows if row not in planted] == hr_rows(commission)
    assert [row["personnel_file_number"] for row in hr_rows(commission)] == [
        row.personnel_file_number for row in load_roster_rows(commission)
    ]
    assert [row for row in rows if row in planted] == planted
    assert 5 <= len(planted) <= 8


@pytest.mark.parametrize("commission", COMMISSIONS)
def test_planted_duplicates_follow_the_row_they_repeat(commission: str) -> None:
    rows = roster_rows(commission)
    for planted in PLANTED[commission]:
        if planted.code != "duplicate-in-file":
            continue
        position = rows.index(planted.values)
        earlier = [row[planted.field].lower() for row in rows[:position]]
        assert planted.values[planted.field].lower() in earlier
