"""Demo roster files and the IPRS / HR rows derived from them."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
ROSTER_DIR = FIXTURES_DIR / "rosters"


@dataclass(frozen=True)
class RosterRow:
    personnel_file_number: str
    full_name: str
    national_id: str
    designation: str
    job_group: str
    reporting_entity: str
    employer_code: str
    appointment_date: date
    email: str
    phone: str
    date_of_birth: date
    sex: str
    place_of_birth: str
    kra_pin: str
    annual_income: Decimal


@dataclass(frozen=True)
class ExtraPerson:
    national_id: str
    first_name: str
    middle_name: str
    last_name: str
    date_of_birth: date
    sex: str
    place_of_birth: str
    kra_pin: str
    annual_income: Decimal


@dataclass(frozen=True)
class Dependant:
    national_id: str
    first_name: str
    middle_name: str
    last_name: str
    date_of_birth: date
    sex: str
    place_of_birth: str


def parse_name(full_name: str) -> tuple[str, str, str]:
    parts = full_name.split()
    if len(parts) < 2:
        raise ValueError(f"fullName needs at least two parts: {full_name!r}")
    if len(parts) == 2:
        return parts[0], "", parts[1]
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def _date(value: str) -> date:
    return date.fromisoformat(value)


def load_roster_rows() -> list[RosterRow]:
    rows: list[RosterRow] = []
    for path in sorted(ROSTER_DIR.glob("*.csv")):
        with path.open(newline="", encoding="utf-8") as handle:
            for raw in csv.DictReader(handle):
                rows.append(
                    RosterRow(
                        personnel_file_number=raw["personnelFileNumber"],
                        full_name=raw["fullName"],
                        national_id=raw["nationalId"],
                        designation=raw["designation"],
                        job_group=raw["jobGroup"],
                        reporting_entity=raw["reportingEntity"],
                        employer_code=raw["employerCode"],
                        appointment_date=_date(raw["appointmentDate"]),
                        email=raw["email"],
                        phone=raw["phone"],
                        date_of_birth=_date(raw["dateOfBirth"]),
                        sex=raw["sex"],
                        place_of_birth=raw["placeOfBirth"],
                        kra_pin=raw["kraPin"],
                        annual_income=Decimal(raw["annualIncome"]),
                    )
                )
    return rows


def load_extra_people() -> list[ExtraPerson]:
    path = FIXTURES_DIR / "people-extra.csv"
    with path.open(newline="", encoding="utf-8") as handle:
        return [
            ExtraPerson(
                national_id=raw["nationalId"],
                first_name=raw["firstName"],
                middle_name=raw["middleName"],
                last_name=raw["lastName"],
                date_of_birth=_date(raw["dateOfBirth"]),
                sex=raw["sex"],
                place_of_birth=raw["placeOfBirth"],
                kra_pin=raw["kraPin"],
                annual_income=Decimal(raw["annualIncome"]),
            )
            for raw in csv.DictReader(handle)
        ]


def load_dependants() -> list[Dependant]:
    path = FIXTURES_DIR / "dependants.csv"
    with path.open(newline="", encoding="utf-8") as handle:
        return [
            Dependant(
                national_id=raw["nationalId"],
                first_name=raw["firstName"],
                middle_name=raw["middleName"],
                last_name=raw["lastName"],
                date_of_birth=_date(raw["dateOfBirth"]),
                sex=raw["sex"],
                place_of_birth=raw["placeOfBirth"],
            )
            for raw in csv.DictReader(handle)
        ]
