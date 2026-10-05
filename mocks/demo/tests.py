import csv
import io

import pytest
from django.test import Client

from ardhisasa.models import Parcel
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


SYNTHETIC_REQUEST = {
    "seed": "test",
    "anchor": "2026-10-01",
    "commissions": [
        {
            "slug": "npsc",
            "index": 4,
            "count": 25,
            "employerCode": "NPS",
            "reportingEntity": "National Police Service",
            "emailDomain": "npsc.go.ke",
        }
    ],
}


@pytest.mark.django_db
def test_synthetic_officers_are_the_same_people_every_time(client: Client) -> None:
    first = client.post(
        "/demo/synthetic-officers", SYNTHETIC_REQUEST, content_type="application/json"
    )
    again = client.post(
        "/demo/synthetic-officers", SYNTHETIC_REQUEST, content_type="application/json"
    )

    assert first.status_code == 200
    assert first.json()["created"] == 25
    assert again.json()["created"] == 0
    assert again.json()["officers"] == first.json()["officers"]


@pytest.mark.django_db
def test_synthetic_officers_hold_what_their_registries_return(client: Client) -> None:
    officers = client.post(
        "/demo/synthetic-officers", SYNTHETIC_REQUEST, content_type="application/json"
    ).json()["officers"]["npsc"]

    for officer in officers:
        assert Person.objects.filter(id_number=officer["nationalId"]).exists()
        assert Employment.objects.filter(personal_number=officer["personnelFileNumber"]).exists()
        vehicles = {h["reference"] for h in officer["holdings"] if h["kind"] == "vehicle"}
        owned = set(
            Vehicle.objects.filter(owner_id_number=officer["nationalId"]).values_list(
                "registration_number", flat=True
            )
        )
        assert owned == vehicles
        parcels = {
            (h["reference"], h["county"], h["areaHectares"])
            for h in officer["holdings"]
            if h["kind"] == "parcel"
        }
        held = {
            (p.parcel_number, p.county, str(p.area_hectares))
            for p in Parcel.objects.filter(owner_id_number=officer["nationalId"])
        }
        assert held == parcels


@pytest.mark.django_db
def test_synthetic_officers_refuse_a_bad_request(client: Client) -> None:
    response = client.post(
        "/demo/synthetic-officers", {"seed": "x"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("commission", COMMISSIONS)
def test_the_served_roster_file_names_officers_as_iprs_does(
    client: Client, commission: str
) -> None:
    # #679: beat A imported a roster file from a stale checkout and renamed PSC/2012/0311 back to
    # a name IPRS no longer holds, so beat B's identity check failed. The stack serves the file.
    seed_demo()
    response = client.get(f"/demo/files/{commission}-roster.csv")

    assert response.status_code == 200
    assert response["Content-Type"] == "text/csv"
    assert f'filename="{commission}-roster.csv"' in response["Content-Disposition"]
    served = response.getvalue().decode("utf-8")
    assert served == roster_csv(commission)
    names = {
        (row["personnel_file_number"], row["national_id"]): row["full_name"]
        for row in csv.DictReader(io.StringIO(served))
    }
    for officer in load_roster_rows(commission):
        person = Person.objects.get(id_number=officer.national_id)
        iprs_name = " ".join(
            part for part in (person.first_name, person.middle_name, person.last_name) if part
        )
        key = (officer.personnel_file_number, officer.national_id)
        assert names[key] == iprs_name, officer.personnel_file_number


def test_the_served_files_include_the_filing_samples(client: Client) -> None:
    response = client.get("/demo/files/payslip-kemsa-june-2026.pdf")

    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"


@pytest.mark.parametrize("name", ["nope.csv", "..", ".gitkeep", "README.md"])
def test_only_demo_files_are_served(client: Client, name: str) -> None:
    assert client.get(f"/demo/files/{name}").status_code == 404
