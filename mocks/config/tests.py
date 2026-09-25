import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_health_reports_up_when_database_answers(api: APIClient) -> None:
    response = api.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "up"}
