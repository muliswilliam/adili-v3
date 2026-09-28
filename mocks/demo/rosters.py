"""Demo roster files for the console's import wizard (spec 02 #44).

Each Commission's file is its HR data (`fixtures/rosters/<commission>.csv`, the rows
`seed_demo` loads into the HR and IPRS mocks) in the roster template's snake_case columns,
with a handful of planted bad rows so the import report has something to show. Generated,
not edited: `python manage.py generate_rosters` (`pnpm --filter @adili/mocks roster:files`)
rewrites `demo/rosters/`.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path

from demo.fixtures import load_roster_rows

OUTPUT_DIR = Path(__file__).resolve().parent / "rosters"

COMMISSIONS = ("psc", "tsc")

# The roster template's columns, in its order (services/directory/src/roster/columns.ts).
TEMPLATE_COLUMNS = (
    "personnel_file_number",
    "full_name",
    "national_id",
    "designation",
    "job_group",
    "reporting_entity",
    "appointment_date",
    "email",
    "phone",
)


@dataclass(frozen=True)
class PlantedRow:
    """A bad row the import rejects, and the field and code it is rejected with."""

    values: dict[str, str]
    field: str
    code: str


def _row(**values: str) -> dict[str, str]:
    return {column: values.get(column, "") for column in TEMPLATE_COLUMNS}


# Each planted row goes after the HR row at the same index, so a duplicate always follows the
# row it repeats. Fields and codes are the directory's `RowError` ones.
PLANTED: dict[str, tuple[PlantedRow, ...]] = {
    "psc": (
        PlantedRow(
            _row(
                personnel_file_number="PSC/2020/0415",
                full_name="Mutua Daniel Musyoka",
                national_id="2918O447",
                designation="Accountant",
                job_group="K",
                reporting_entity="Public Service Commission",
                appointment_date="2020-02-03",
            ),
            field="national_id",
            code="format",
        ),
        PlantedRow(
            _row(
                personnel_file_number="KEMSA/2011/0457",
                full_name="Njoroge Paul Mwangi",
                national_id="29733104",
                designation="Driver",
                job_group="G",
                reporting_entity="Kenya Medical Supplies Authority",
            ),
            field="personnel_file_number",
            code="duplicate-in-file",
        ),
        PlantedRow(
            _row(
                personnel_file_number="PSC/2021/0533",
                full_name="Wairimu Joy Gathoni",
                national_id="34410295",
                designation="Records Officer",
                job_group="H",
                reporting_entity="Public Service Commission",
                appointment_date="2201-07-01",
            ),
            field="appointment_date",
            code="future-date",
        ),
        PlantedRow(
            _row(
                personnel_file_number="PSC/2017/0260",
                full_name="Barasa Collins Wekesa",
                national_id="30662871",
                designation="ICT Officer",
                job_group="K",
                reporting_entity="Public Service Commission",
                email="collins.barasa.publicservice.go.ke",
            ),
            field="email",
            code="format",
        ),
        PlantedRow(
            _row(
                personnel_file_number="MOH/2016/2210",
                full_name="Adhiambo Lucy Akinyi",
                national_id="31804526",
                designation="Clinical Officer",
                job_group="J",
                reporting_entity="Ministry of Health",
                phone="0712 34",
            ),
            field="phone",
            code="format",
        ),
        PlantedRow(
            _row(
                personnel_file_number="PSC/2019/0301",
                national_id="32258810",
                designation="Clerical Officer",
                job_group="F",
                reporting_entity="Public Service Commission",
            ),
            field="full_name",
            code="required",
        ),
    ),
    "tsc": (
        PlantedRow(
            _row(
                personnel_file_number="TSC/2011/KAKAMEGA/PRIMARY/00219",
                full_name="Makokha Janet Nafula",
                national_id="28340917",
                designation="Teacher",
                job_group="C2",
                reporting_entity="Kakamega Primary School",
            ),
            field="personnel_file_number",
            code="too-long",
        ),
        PlantedRow(
            _row(
                personnel_file_number="TSC/052871",
                full_name="Kiplagat Moses Kiprotich",
                national_id="23456781",
                designation="Teacher",
                job_group="C1",
                reporting_entity="Kapsabet Boys High School",
            ),
            field="national_id",
            code="duplicate-in-file",
        ),
        PlantedRow(
            _row(
                personnel_file_number="TSC/039002",
                full_name="Auma Beatrice Anyango",
                national_id="29981354",
                designation="Senior Teacher",
                job_group="C3",
                reporting_entity="Kisumu Day High School",
                appointment_date="31/02/2015",
            ),
            field="appointment_date",
            code="format",
        ),
        PlantedRow(
            _row(
                personnel_file_number="TSC/061744",
                full_name="Ndungu Samuel Kimani",
                national_id="4471",
                designation="Teacher",
                job_group="C1",
                reporting_entity="Alliance High School",
            ),
            field="national_id",
            code="format",
        ),
        PlantedRow(
            _row(
                personnel_file_number="TSC/022589",
                full_name="Mohamed Fatuma Halima",
                national_id="27719043",
                designation="Deputy Principal",
                job_group="D1 (SENIOR)",
                reporting_entity="Garissa High School",
            ),
            field="job_group",
            code="too-long",
        ),
        PlantedRow(
            _row(
                personnel_file_number="TSC/058163",
                full_name="Wanjala Edwin Simiyu",
                national_id="32906718",
                designation="Teacher",
                job_group="C2",
                reporting_entity="Maseno School",
                email="edwin.simiyu@tsc",
            ),
            field="email",
            code="format",
        ),
    ),
}


def hr_rows(commission: str) -> list[dict[str, str]]:
    """The Commission's HR records as roster template rows."""
    return [
        _row(
            personnel_file_number=row.personnel_file_number,
            full_name=row.full_name,
            national_id=row.national_id,
            designation=row.designation,
            job_group=row.job_group,
            reporting_entity=row.reporting_entity,
            appointment_date=row.appointment_date.isoformat(),
            email=row.email,
            phone=row.phone,
        )
        for row in load_roster_rows(commission)
    ]


def roster_rows(commission: str) -> list[dict[str, str]]:
    """The demo file's rows: the HR rows with the planted bad rows interleaved."""
    rows = hr_rows(commission)
    planted = PLANTED[commission]
    out: list[dict[str, str]] = []
    for index, row in enumerate(rows):
        out.append(row)
        if index < len(planted):
            out.append(planted[index].values)
    out.extend(planted_row.values for planted_row in planted[len(rows) :])
    return out


def roster_csv(commission: str) -> str:
    """The demo file as CSV text: RFC 4180 quoting, UTF-8, LF line ends."""
    buffer = io.StringIO()
    # LF line ends, as the repository stores text files (core.autocrlf=input).
    writer = csv.DictWriter(buffer, fieldnames=TEMPLATE_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(roster_rows(commission))
    return buffer.getvalue()


def roster_path(commission: str) -> Path:
    return OUTPUT_DIR / f"{commission}-roster.csv"


def write_roster_files() -> list[Path]:
    """Writes every demo roster file; returns their paths."""
    OUTPUT_DIR.mkdir(exist_ok=True)
    paths = []
    for commission in COMMISSIONS:
        path = roster_path(commission)
        path.write_text(roster_csv(commission), encoding="utf-8", newline="")
        paths.append(path)
    return paths
