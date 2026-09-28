from typing import Any

from django.core.management.base import BaseCommand

from demo.rosters import write_roster_files


class Command(BaseCommand):
    help = (
        "Writes the demo roster files (demo/rosters/<commission>-roster.csv) from the HR mock "
        "data, with planted bad rows for the import report (spec 02 #44)."
    )

    def handle(self, *args: Any, **options: Any) -> None:
        for path in write_roster_files():
            self.stdout.write(self.style.SUCCESS(f"Wrote {path}"))
