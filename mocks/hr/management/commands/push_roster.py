from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from hr.push import push_demo_roster


class Command(BaseCommand):
    help = (
        "Push the demo PSC roster batch and one exit to the directory "
        "(spec 02 #54). Needs DIRECTORY_API_URL and DIRECTORY_HR_TOKEN."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the batch and exit payloads without calling the directory.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            results = push_demo_roster(dry_run=options["dry_run"])
        except ConnectionError as error:
            raise CommandError(str(error)) from error
        for result in results:
            self.stdout.write(f"{result.status or 'dry-run'} {result.url}")
            self.stdout.write(str(result.body))
        if not options["dry_run"] and any(result.status >= 400 for result in results):
            raise CommandError("Directory rejected the roster push")
