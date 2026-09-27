import pytest
from rest_framework.test import APIClient

from config.faults import reset_rate_limits
from demo.seed import seed_demo


@pytest.fixture(autouse=True)
def _reset_rate_limits() -> None:
    reset_rate_limits()


@pytest.fixture
def api() -> APIClient:
    return APIClient()


@pytest.fixture
def seeded(db: None) -> None:
    seed_demo()
