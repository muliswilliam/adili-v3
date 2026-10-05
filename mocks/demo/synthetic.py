"""Synthetic officers for the demo's volume (#617): IPRS, KRA, HR and registry records.

`generate` is deterministic: the same seed, Commission and count give the same people, so the
demo seed can ask again and get what it asked for before, and `store` upserts them, so a second
run changes nothing. Each Commission's officers live in their own national ID block, apart from
the named fixtures (`demo/fixtures/rosters/`), so they never collide with a persona.

Registry holdings carry the date they were registered. The demo seed declares from them: what
was registered after a cycle's statement date is a change for that cycle, and leaving a holding
out of a declaration is how it plants a registry mismatch (spec 07b).
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction

from ardhisasa.models import Parcel
from brs.models import Company, Directorship
from hr.models import Employment
from iprs.models import Person
from kra.models import Taxpayer
from ntsa.models import Vehicle

# National ID blocks: 60,000,000 + 1,000,000 per Commission index. The fixtures sit below 45M.
ID_BASE = 60_000_000
ID_BLOCK = 1_000_000
# Vehicle registrations repeat after 13,000 officers (26 letters x 1,000 numbers).
MAX_PER_COMMISSION = 10_000

FIRST_NAMES = {
    "F": ["Akinyi", "Wambui", "Chebet", "Njeri", "Atieno", "Wanjiru", "Nafula", "Moraa",
          "Halima", "Jepkoech", "Mumbi", "Adhiambo", "Kerubo", "Zawadi", "Nekesa", "Wairimu"],
    "M": ["Otieno", "Kamau", "Kipchoge", "Mwangi", "Omondi", "Barasa", "Kiprotich", "Mutua",
          "Hassan", "Ochieng", "Njoroge", "Wekesa", "Onyango", "Kibet", "Juma", "Muriuki"],
}  # fmt: skip
MIDDLE_NAMES = ["Grace", "Peter", "Mary", "John", "Faith", "James", "Ruth", "David", "Esther",
                "Joseph", "Mercy", "Daniel", "Lucy", "Samuel", "Ann", "Paul"]  # fmt: skip
SURNAMES = ["Kariuki", "Odhiambo", "Kiptoo", "Wafula", "Mutiso", "Nyambura", "Ouma", "Rotich",
            "Maina", "Achieng", "Kilonzo", "Wanyama", "Gitau", "Owino", "Langat", "Ndungu",
            "Mohamed", "Cheruiyot", "Kimani", "Okoth"]  # fmt: skip
COUNTIES = ["Nairobi", "Kiambu", "Nakuru", "Kisumu", "Mombasa", "Machakos", "Uasin Gishu",
            "Kakamega", "Nyeri", "Kisii", "Meru", "Kilifi", "Bungoma", "Kericho"]  # fmt: skip
DESIGNATIONS = [("Clerical Officer", "G"), ("Accountant", "J"), ("Administrative Officer", "K"),
                ("Senior Officer", "L"), ("Principal Officer", "M"), ("Assistant Director", "N"),
                ("Deputy Director", "P"), ("Records Officer", "H"), ("ICT Officer", "K"),
                ("Procurement Officer", "K")]  # fmt: skip
VEHICLES = [("Toyota", "Axio"), ("Toyota", "Fielder"), ("Nissan", "Note"), ("Mazda", "Demio"),
            ("Subaru", "Forester"), ("Toyota", "Premio"), ("Honda", "Fit"),
            ("Mitsubishi", "Outlander")]  # fmt: skip

# Appointment mix. Most officers were appointed long before the demo's cycles; a few recently,
# so they owe an initial declaration as well (some due already, so filing it now is late).
RECENT_SHARE = 0.06


@dataclass(frozen=True)
class CommissionSpec:
    slug: str
    index: int
    count: int
    employer_code: str
    reporting_entity: str
    email_domain: str


@dataclass
class Holding:
    kind: str  # vehicle | parcel | company
    reference: str
    description: str
    registered_on: str
    value_kes: int
    # Parcels only: the county and area ArdhiSasa holds, which the officer declares.
    county: str = ""
    area_hectares: str = ""


@dataclass
class SyntheticOfficer:
    personnel_file_number: str
    full_name: str
    national_id: str
    designation: str
    job_group: str
    reporting_entity: str
    employer_code: str
    appointment_date: str
    email: str
    phone: str
    date_of_birth: str
    sex: str
    place_of_birth: str
    kra_pin: str
    tax_compliant: bool
    annual_income_kes: int
    holdings: list[Holding] = field(default_factory=list)


def generate(seed: str, spec: CommissionSpec, anchor: date) -> list[SyntheticOfficer]:
    if not 0 < spec.count <= MAX_PER_COMMISSION:
        raise ValueError(f"count must be 1..{MAX_PER_COMMISSION}")
    return [_officer(seed, spec, n, anchor) for n in range(spec.count)]


def _officer(seed: str, spec: CommissionSpec, n: int, anchor: date) -> SyntheticOfficer:
    rng = random.Random(f"{seed}:{spec.slug}:{n}")
    national_id = str(ID_BASE + spec.index * ID_BLOCK + n)
    sex = rng.choice(["F", "M"])
    first = rng.choice(FIRST_NAMES[sex])
    middle = rng.choice(MIDDLE_NAMES)
    last = rng.choice(SURNAMES)
    dob = date(1966, 1, 1) + timedelta(days=rng.randrange(365 * 32))
    if rng.random() < RECENT_SHARE:
        # Within 20 months of the anchor: owes an initial declaration.
        appointed = anchor - timedelta(days=rng.randrange(5, 600))
    else:
        appointed = date(2000, 1, 3) + timedelta(days=rng.randrange(365 * 23))
    designation, job_group = rng.choice(DESIGNATIONS)
    income = rng.randrange(600, 4800) * 1000
    holdings: list[Holding] = []
    for v in range(rng.choice([0, 1, 1, 2])):
        make, model = rng.choice(VEHICLES)
        registered = _registered(rng, appointed)
        holdings.append(
            Holding(
                kind="vehicle",
                reference=f"K{chr(65 + spec.index)}{chr(65 + n % 26)} {n % 1000:03d}{chr(65 + v)}",
                description=f"{make} {model}",
                registered_on=registered.isoformat(),
                value_kes=rng.randrange(6, 45) * 100_000,
            )
        )
    for p in range(rng.choice([0, 0, 1, 1, 2])):
        county = rng.choice(COUNTIES)
        holdings.append(
            Holding(
                kind="parcel",
                reference=f"{county.upper()}/DEMO {spec.index}/{n}{p}",
                description=f"Plot in {county}",
                registered_on=_registered(rng, appointed).isoformat(),
                value_kes=rng.randrange(8, 120) * 100_000,
                county=county,
                area_hectares=str(Decimal("0.0450") * (1 + int(national_id) % 5)),
            )
        )
    if rng.random() < 0.15:
        holdings.append(
            Holding(
                kind="company",
                reference=f"PVT-D{spec.index}{n:06d}",
                description=f"{last} {rng.choice(['Enterprises', 'Holdings', 'Traders'])} Limited",
                registered_on=_registered(rng, appointed).isoformat(),
                value_kes=rng.randrange(1, 20) * 100_000,
            )
        )
    return SyntheticOfficer(
        personnel_file_number=f"{spec.employer_code}/{appointed.year}/{n:05d}",
        full_name=f"{first} {middle} {last}",
        national_id=national_id,
        designation=designation,
        job_group=job_group,
        reporting_entity=spec.reporting_entity,
        employer_code=spec.employer_code,
        appointment_date=appointed.isoformat(),
        email=f"{first}.{last}.{n}@{spec.email_domain}".lower(),
        phone=f"+2547{spec.index}{n:07d}",
        date_of_birth=dob.isoformat(),
        sex=sex,
        place_of_birth=rng.choice(COUNTIES),
        kra_pin=f"A{national_id}{chr(65 + n % 26)}",
        tax_compliant=rng.random() >= 0.03,
        annual_income_kes=income,
        holdings=holdings,
    )


def _registered(rng: random.Random, appointed: date) -> date:
    """Mostly before the earlier demo cycle; about one in eight since, a change to declare."""
    if rng.random() < 0.12:
        return date(2024, 9, 1) + timedelta(days=rng.randrange(600))
    start = min(appointed, date(2023, 1, 1))
    return start - timedelta(days=rng.randrange(365 * 8))


@transaction.atomic
def store(officers: list[SyntheticOfficer]) -> int:
    """Upserts every record the officers need in IPRS, KRA, HR, NTSA, ArdhiSasa and BRS.

    Returns how many officers IPRS did not know before.
    """
    if not officers:
        return 0
    known = Person.objects.filter(id_number__in=[o.national_id for o in officers]).count()
    Person.objects.bulk_create(
        [
            Person(
                id_number=o.national_id,
                first_name=o.full_name.split(" ")[0],
                middle_name=o.full_name.split(" ")[1],
                last_name=o.full_name.split(" ")[2],
                date_of_birth=date.fromisoformat(o.date_of_birth),
                sex=o.sex,
                place_of_birth=o.place_of_birth,
                date_of_issue=date.fromisoformat(o.date_of_birth).replace(month=1, day=15)
                + timedelta(days=365 * 18 + 5),
            )
            for o in officers
        ],
        update_conflicts=True,
        unique_fields=["id_number"],
        update_fields=["first_name", "middle_name", "last_name", "date_of_birth", "sex",
                       "place_of_birth", "date_of_issue"],
    )  # fmt: skip
    Taxpayer.objects.bulk_create(
        [
            Taxpayer(
                id_number=o.national_id,
                pin=o.kra_pin,
                name=o.full_name.upper(),
                registered_on=date.fromisoformat(o.date_of_birth) + timedelta(days=365 * 23),
                compliance_status="compliant" if o.tax_compliant else "non_compliant",
                compliance_certificate_number=f"TCC{o.national_id}" if o.tax_compliant else "",
                compliance_valid_until=date(2027, 6, 30) if o.tax_compliant else None,
                annual_income_declared=Decimal(o.annual_income_kes),
            )
            for o in officers
        ],
        update_conflicts=True,
        unique_fields=["id_number"],
        update_fields=["pin", "name", "registered_on", "compliance_status",
                       "compliance_certificate_number", "compliance_valid_until",
                       "annual_income_declared"],
    )  # fmt: skip
    Employment.objects.bulk_create(
        [
            Employment(
                id_number=o.national_id,
                personal_number=o.personnel_file_number,
                full_name=o.full_name,
                employer_code=o.employer_code,
                employer_name=o.reporting_entity,
                job_title=o.designation,
                job_group=o.job_group,
                appointment_date=date.fromisoformat(o.appointment_date),
                status="active",
                exit_date=None,
            )
            for o in officers
        ],
        update_conflicts=True,
        unique_fields=["employer_code", "personal_number"],
        update_fields=["id_number", "full_name", "employer_name", "job_title", "job_group",
                       "appointment_date", "status", "exit_date"],
    )  # fmt: skip
    holdings = [(o, h) for o in officers for h in o.holdings]
    Vehicle.objects.bulk_create(
        [
            Vehicle(
                registration_number=h.reference,
                make=h.description.split(" ", 1)[0],
                model=h.description.split(" ", 1)[1],
                year_of_manufacture=min(int(h.registered_on[:4]), 2025) - 3,
                owner_id_number=o.national_id,
                registered_on=date.fromisoformat(h.registered_on),
            )
            for o, h in holdings
            if h.kind == "vehicle"
        ],
        update_conflicts=True,
        unique_fields=["registration_number"],
        update_fields=["make", "model", "year_of_manufacture", "owner_id_number",
                       "registered_on"],
    )  # fmt: skip
    Parcel.objects.bulk_create(
        [
            Parcel(
                parcel_number=h.reference,
                county=h.county,
                area_hectares=Decimal(h.area_hectares),
                tenure="freehold",
                owner_id_number=o.national_id,
                registered_on=date.fromisoformat(h.registered_on),
            )
            for o, h in holdings
            if h.kind == "parcel"
        ],
        update_conflicts=True,
        unique_fields=["parcel_number"],
        update_fields=["county", "area_hectares", "tenure", "owner_id_number", "registered_on"],
    )
    companies = [(o, h) for o, h in holdings if h.kind == "company"]
    Company.objects.bulk_create(
        [
            Company(
                registration_number=h.reference,
                name=h.description,
                status="active",
                registered_on=date.fromisoformat(h.registered_on),
            )
            for _, h in companies
        ],
        update_conflicts=True,
        unique_fields=["registration_number"],
        update_fields=["name", "status", "registered_on"],
    )
    by_registration = {
        c.registration_number: c
        for c in Company.objects.filter(registration_number__in=[h.reference for _, h in companies])
    }
    Directorship.objects.bulk_create(
        [
            Directorship(
                company=by_registration[h.reference],
                id_number=o.national_id,
                full_name=o.full_name,
                role="director_shareholder",
                shares=100,
                appointed_on=date.fromisoformat(h.registered_on),
            )
            for o, h in companies
        ],
        update_conflicts=True,
        unique_fields=["company", "id_number"],
        update_fields=["full_name", "role", "shares", "appointed_on"],
    )
    return len(officers) - known


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def _camel_keys(value: object) -> object:
    if isinstance(value, dict):
        return {_camel(key): _camel_keys(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_camel_keys(item) for item in value]
    return value


def as_json(officers: list[SyntheticOfficer]) -> list[object]:
    """The officers as the demo seed reads them: the roster's camelCase field names."""
    return [_camel_keys(asdict(o)) for o in officers]
