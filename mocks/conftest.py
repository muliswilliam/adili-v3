import pytest
from rest_framework.test import APIClient

from config.registry_control import reset
from demo.seed import seed_demo


@pytest.fixture(autouse=True)
def _reset_registry_control() -> None:
    reset()


@pytest.fixture
def api() -> APIClient:
    return APIClient()


@pytest.fixture
def seeded(db: None) -> None:
    seed_demo()
