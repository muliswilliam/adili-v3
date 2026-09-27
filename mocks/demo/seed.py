"""Synthetic, internally consistent records across every simulated system.

IPRS persons and HR employments come from `demo/fixtures/rosters/` so onboarding
matches the spec 02 demo roster files. The same national IDs appear in KRA, NTSA,
BRS and ArdhiSasa. A few records are planted to surface in the demo:

- Wanjiku Kamau (declarant) owns a vehicle and a Kajiado parcel she has not declared, and is
  a director of a company that supplies her employer (KEMSA).
- Kiprono Chebet is not tax compliant.
"""

from datetime import date
from decimal import Decimal

from django.db import transaction

from ardhisasa.models import Parcel
from brs.models import Company, Directorship
from demo.fixtures import load_dependants, load_extra_people, load_roster_rows, parse_name
from hr.models import Employment
from iprs.models import Person
from kra.models import Taxpayer
from ntsa.models import Vehicle

# (registration, make, model, year, owner, registered_on)
VEHICLES = [
    ("KCX 214J", "Toyota", "Fielder", 2016, "27451863", date(2019, 5, 12)),
    ("KDK 482M", "Toyota", "Land Cruiser Prado", 2023, "27451863", date(2024, 11, 4)),
    ("KCB 903T", "Mazda", "CX-5", 2014, "24718355", date(2017, 2, 20)),
    ("KDA 118Q", "Nissan", "X-Trail", 2019, "22607781", date(2021, 7, 30)),
]

# (parcel_number, county, hectares, tenure, owner, registered_on)
PARCELS = [
    ("KIAMBU/RUIRU EAST BLOCK 2/4417", "Kiambu", "0.0450", "freehold", "27451863",
     date(2014, 9, 3)),
    ("KAJIADO/KITENGELA/59821", "Kajiado", "2.0235", "freehold", "27451863", date(2025, 1, 17)),
    ("NAIROBI/BLOCK 82/1934", "Nairobi", "0.0930", "leasehold", "22607781", date(2010, 6, 11)),
]  # fmt: skip

# (registration, name, status, registered_on, [(id_number, role, shares, appointed_on)])
COMPANIES = [
    ("PVT-9XYZ2L4Q", "Afya Bora Medical Supplies Limited", "active", date(2022, 2, 14),
     [("27451863", "director_shareholder", 400, date(2022, 2, 14)),
      ("24718355", "director_shareholder", 600, date(2022, 2, 14))]),
    ("PVT-3KLM8R2T", "Rift Valley Agrovet Limited", "active", date(2015, 8, 3),
     [("22607781", "shareholder", 250, date(2015, 8, 3))]),
]  # fmt: skip

NON_COMPLIANT_TAXPAYERS = {"22607781"}


def _full_name(first: str, middle: str, last: str) -> str:
    return " ".join(part for part in (first, middle, last) if part)


def _upsert_person(
    id_number: str,
    first_name: str,
    middle_name: str,
    last_name: str,
    date_of_birth: date,
    sex: str,
    place_of_birth: str,
    date_of_issue: date,
) -> None:
    Person.objects.update_or_create(
        id_number=id_number,
        defaults={
            "first_name": first_name,
            "middle_name": middle_name,
            "last_name": last_name,
            "date_of_birth": date_of_birth,
            "sex": sex,
            "place_of_birth": place_of_birth,
            "date_of_issue": date_of_issue,
        },
    )


def _upsert_taxpayer(
    id_number: str,
    name: str,
    kra_pin: str,
    date_of_birth: date,
    annual_income: Decimal,
) -> None:
    compliant = id_number not in NON_COMPLIANT_TAXPAYERS
    Taxpayer.objects.update_or_create(
        id_number=id_number,
        defaults={
            "pin": kra_pin,
            "name": name.upper(),
            "registered_on": date(date_of_birth.year + 22, 3, 1),
            "compliance_status": "compliant" if compliant else "non_compliant",
            "compliance_certificate_number": f"TCC{id_number}" if compliant else "",
            "compliance_valid_until": date(2027, 6, 30) if compliant else None,
            "annual_income_declared": annual_income,
        },
    )


@transaction.atomic
def seed_demo() -> None:
    """Creates or refreshes every demo record. Safe to run repeatedly."""
    names_by_id: dict[str, str] = {}

    for row in load_roster_rows():
        first, middle, last = parse_name(row.full_name)
        names_by_id[row.national_id] = row.full_name
        _upsert_person(
            row.national_id,
            first,
            middle,
            last,
            row.date_of_birth,
            row.sex,
            row.place_of_birth,
            date(row.date_of_birth.year + 18, 1, 15),
        )
        _upsert_taxpayer(
            row.national_id,
            row.full_name,
            row.kra_pin,
            row.date_of_birth,
            row.annual_income,
        )
        Employment.objects.update_or_create(
            employer_code=row.employer_code,
            personal_number=row.personnel_file_number,
            defaults={
                "id_number": row.national_id,
                "full_name": row.full_name,
                "employer_name": row.reporting_entity,
                "job_title": row.designation,
                "job_group": row.job_group,
                "appointment_date": row.appointment_date,
                "status": "active",
                "exit_date": None,
            },
        )

    for person in load_extra_people():
        names_by_id[person.national_id] = _full_name(
            person.first_name, person.middle_name, person.last_name
        )
        _upsert_person(
            person.national_id,
            person.first_name,
            person.middle_name,
            person.last_name,
            person.date_of_birth,
            person.sex,
            person.place_of_birth,
            date(person.date_of_birth.year + 18, 1, 15),
        )
        _upsert_taxpayer(
            person.national_id,
            names_by_id[person.national_id],
            person.kra_pin,
            person.date_of_birth,
            person.annual_income,
        )

    for child in load_dependants():
        _upsert_person(
            child.national_id,
            child.first_name,
            child.middle_name,
            child.last_name,
            child.date_of_birth,
            child.sex,
            child.place_of_birth,
            child.date_of_birth,
        )

    for registration, make, model, year, owner, registered_on in VEHICLES:
        Vehicle.objects.update_or_create(
            registration_number=registration,
            defaults={
                "make": make,
                "model": model,
                "year_of_manufacture": year,
                "owner_id_number": owner,
                "registered_on": registered_on,
            },
        )

    for parcel_number, county, hectares, tenure, owner, registered_on in PARCELS:
        Parcel.objects.update_or_create(
            parcel_number=parcel_number,
            defaults={
                "county": county,
                "area_hectares": Decimal(hectares),
                "tenure": tenure,
                "owner_id_number": owner,
                "registered_on": registered_on,
            },
        )

    for registration, name, status, registered_on, officers in COMPANIES:
        company, _ = Company.objects.update_or_create(
            registration_number=registration,
            defaults={"name": name, "status": status, "registered_on": registered_on},
        )
        for id_number, role, shares, appointed_on in officers:
            Directorship.objects.update_or_create(
                company=company,
                id_number=id_number,
                defaults={
                    "full_name": names_by_id[id_number],
                    "role": role,
                    "shares": shares,
                    "appointed_on": appointed_on,
                },
            )
