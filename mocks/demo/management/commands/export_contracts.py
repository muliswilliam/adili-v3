from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandParser
from drf_spectacular.generators import SchemaGenerator
from drf_spectacular.renderers import OpenApiYamlRenderer

from config.urls import SYSTEM_URLCONFS

DEFAULT_OUTPUT = Path(__file__).resolve().parents[4] / "packages" / "schemas" / "external"

TITLES = {
    "iprs": "IPRS (Integrated Population Registration System)",
    "kra": "KRA (Kenya Revenue Authority)",
    "ntsa": "NTSA (National Transport and Safety Authority)",
    "brs": "BRS (Business Registration Service)",
    "ardhisasa": "ArdhiSasa (National Land Information Management System)",
    "hr": "HR (public service HRMIS)",
    "payroll": "Payroll (IPPD)",
    "icms": "EACC ICMS (Integrated Case Management System)",
    "sms": "SMS gateway",
}


def add_not_found_responses(schema: dict[str, Any]) -> None:
    """Documents the 404 every lookup by identifier can return."""
    for operations in schema["paths"].values():
        for operation in operations.values():
            has_path_parameter = any(p["in"] == "path" for p in operation.get("parameters", []))
            if has_path_parameter:
                operation["responses"]["404"] = {"description": "No record with this identifier"}


class Command(BaseCommand):
    help = (
        "Writes one OpenAPI 3.1 contract per simulated system to packages/schemas/external. "
        "The integration-gateway adapters are contract-tested against the same files (ADR-012)."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)

    def handle(self, *args: Any, **options: Any) -> None:
        output: Path = options["output"]
        output.mkdir(parents=True, exist_ok=True)
        for urlconf in SYSTEM_URLCONFS:
            system = urlconf.removesuffix(".urls")
            generator = SchemaGenerator(
                urlconf=urlconf,
                title=f"{TITLES[system]} - simulated",
                description=(
                    f"Contract the DIALs platform relies on for {TITLES[system]}. "
                    "Served by the Django mock in `mocks/` during development and demos."
                ),
                version="1.0.0",
            )
            schema = generator.get_schema(request=None, public=True)
            schema["info"]["title"] = generator.title
            schema["info"]["description"] = generator.description
            add_not_found_responses(schema)
            rendered = OpenApiYamlRenderer().render(schema, renderer_context={})
            path = output / f"{system}.yaml"
            path.write_bytes(rendered)
            self.stdout.write(f"wrote {path}")
