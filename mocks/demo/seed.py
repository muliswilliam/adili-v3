"""Synthetic, internally consistent records across every simulated system.

The same national ID numbers appear in IPRS, KRA, HR, NTSA, BRS and ArdhiSasa, matching the
demo accounts in the Keycloak realm. A few records are planted to surface in the demo:

- Wanjiku Kamau (declarant) owns a vehicle and a Kajiado parcel she has not declared, and is
  a director of a company that supplies her employer (KEMSA).
- Kiprono Chebet is not tax compliant.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import transaction

from ardhisasa.models import Parcel
from brs.models import Company, Directorship
from hr.models import Employment
from iprs.models import Person
from kra.models import Taxpayer
from ntsa.models import Vehicle


@dataclass(frozen=True)
class DemoPerson:
    id_number: str
    first_name: str
    middle_name: str
    last_name: str
    date_of_birth: date
    sex: str
    place_of_birth: str
    kra_pin: str
    annual_income: Decimal


WANJIKU = DemoPerson(
    "27451863", "Wanjiku", "Njoki", "Kamau", date(1984, 3, 14), "F", "Kiambu",
    "A004518637K", Decimal("3120000.00"),
)  # fmt: skip
PEOPLE = [
    WANJIKU,
    DemoPerson("24718355", "Peter", "Mwangi", "Kamau", date(1981, 7, 2), "M", "Murang'a",
               "A002471835M", Decimal("1860000.00")),
    DemoPerson("30194427", "Otieno", "Juma", "Odhiambo", date(1988, 11, 23), "M", "Kisumu",
               "A003019442P", Decimal("1440000.00")),
    DemoPerson("28836510", "Achieng", "Atieno", "Njeri", date(1986, 5, 9), "F", "Siaya",
               "A002883651Q", Decimal("2280000.00")),
    DemoPerson("22607781", "Kiprono", "Kibet", "Chebet", date(1979, 1, 30), "M", "Uasin Gishu",
               "A002260778R", Decimal("2640000.00")),
    DemoPerson("31552094", "Amina", "Halima", "Hassan", date(1990, 9, 17), "F", "Mombasa",
               "A003155209S", Decimal("1680000.00")),
]  # fmt: skip

# Wanjiku's dependent children (under 18): registered in IPRS, no other records.
CHILDREN = [
    ("40731125", "Imani", "Wairimu", "Kamau", date(2012, 6, 21), "F"),
    ("40731126", "Baraka", "Kariuki", "Kamau", date(2015, 2, 8), "M"),
]

# (id_number, personal_number, employer_code, employer_name, title, job_group, appointed)
EMPLOYMENTS = [
    ("27451863", "KEMSA/2011/0457", "KEMSA", "Kenya Medical Supplies Authority",
     "Senior Procurement Officer", "M", date(2011, 8, 1)),
    ("30194427", "MOH/2015/1123", "MOH", "Ministry of Health",
     "Human Resource Officer", "K", date(2015, 3, 16)),
    ("28836510", "PSC/2012/0311", "PSC", "Public Service Commission",
     "Compliance Officer", "L", date(2012, 10, 1)),
    ("22607781", "PSC/2006/0098", "PSC", "Public Service Commission",
     "Deputy Director, Compliance", "Q", date(2006, 4, 3)),
    ("31552094", "PSC/2018/0702", "PSC", "Public Service Commission",
     "Legal Officer", "K", date(2018, 1, 8)),
]  # fmt: skip

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


def full_name(person: DemoPerson) -> str:
    return f"{person.first_name} {person.middle_name} {person.last_name}"


@transaction.atomic
def seed_demo() -> None:
    """Creates or refreshes every demo record. Safe to run repeatedly."""
    by_id = {person.id_number: person for person in PEOPLE}

    for person in PEOPLE:
        Person.objects.update_or_create(
            id_number=person.id_number,
            defaults={
                "first_name": person.first_name,
                "middle_name": person.middle_name,
                "last_name": person.last_name,
                "date_of_birth": person.date_of_birth,
                "sex": person.sex,
                "place_of_birth": person.place_of_birth,
                "date_of_issue": date(person.date_of_birth.year + 18, 1, 15),
            },
        )
        compliant = person.id_number not in NON_COMPLIANT_TAXPAYERS
        Taxpayer.objects.update_or_create(
            id_number=person.id_number,
            defaults={
                "pin": person.kra_pin,
                "name": full_name(person).upper(),
                "registered_on": date(person.date_of_birth.year + 22, 3, 1),
                "compliance_status": "compliant" if compliant else "non_compliant",
                "compliance_certificate_number": f"TCC{person.id_number}" if compliant else "",
                "compliance_valid_until": date(2027, 6, 30) if compliant else None,
                "annual_income_declared": person.annual_income,
            },
        )

    for id_number, first, middle, last, born, sex in CHILDREN:
        Person.objects.update_or_create(
            id_number=id_number,
            defaults={
                "first_name": first,
                "middle_name": middle,
                "last_name": last,
                "date_of_birth": born,
                "sex": sex,
                "place_of_birth": "Nairobi",
                # Minors hold birth certificates; the registry still assigns an identifier.
                "date_of_issue": born,
            },
        )

    for id_number, personal_number, code, employer, title, group, appointed in EMPLOYMENTS:
        Employment.objects.update_or_create(
            employer_code=code,
            personal_number=personal_number,
            defaults={
                "id_number": id_number,
                "full_name": full_name(by_id[id_number]),
                "employer_name": employer,
                "job_title": title,
                "job_group": group,
                "appointment_date": appointed,
                "status": "active",
                "exit_date": None,
            },
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
                    "full_name": full_name(by_id[id_number]),
                    "role": role,
                    "shares": shares,
                    "appointed_on": appointed_on,
                },
            )
