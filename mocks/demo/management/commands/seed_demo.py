from typing import Any

from django.core.management.base import BaseCommand

from demo.seed import seed_demo


class Command(BaseCommand):
    help = "Creates or refreshes the synthetic demo records in every simulated system."

    def handle(self, *args: Any, **options: Any) -> None:
        seed_demo()
        self.stdout.write(self.style.SUCCESS("Demo data seeded"))
