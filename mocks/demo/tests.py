import pytest

from demo.seed import seed_demo
from iprs.models import Person
from ntsa.models import Vehicle


@pytest.mark.django_db
def test_seeding_twice_creates_no_duplicates() -> None:
    seed_demo()
    counts = (Person.objects.count(), Vehicle.objects.count())

    seed_demo()

    assert (Person.objects.count(), Vehicle.objects.count()) == counts
