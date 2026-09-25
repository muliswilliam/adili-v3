import pytest
from rest_framework.test import APIClient

from demo.seed import seed_demo


@pytest.fixture
def api() -> APIClient:
    return APIClient()


@pytest.fixture
def seeded(db: None) -> None:
    seed_demo()
