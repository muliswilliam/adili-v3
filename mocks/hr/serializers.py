from dataclasses import dataclass

from rest_framework import serializers

from hr.models import Employment


class EmploymentSerializer(serializers.ModelSerializer[Employment]):
    class Meta:
        model = Employment
        fields = [
            "personal_number",
            "employer_code",
            "employer_name",
            "job_title",
            "job_group",
            "appointment_date",
            "status",
            "exit_date",
        ]


@dataclass(frozen=True)
class Employee:
    id_number: str
    full_name: str
    employments: list[Employment]


class EmployeeSerializer(serializers.Serializer[Employee]):
    """An employee's identity with their employment history, newest first."""

    id_number = serializers.CharField()
    full_name = serializers.CharField()
    employments = EmploymentSerializer(many=True)


@dataclass(frozen=True)
class EmployerSupplierList:
    employer_code: str
    registration_numbers: list[str]


class EmployerSupplierListSerializer(serializers.Serializer[EmployerSupplierList]):
    """Supplier company registration numbers for one employer."""

    employer_code = serializers.CharField()
    registration_numbers = serializers.ListField(child=serializers.CharField())
