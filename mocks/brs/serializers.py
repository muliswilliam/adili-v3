from rest_framework import serializers

from brs.models import Company, Directorship


class PersonDirectorshipSerializer(serializers.ModelSerializer[Directorship]):
    company_registration_number = serializers.CharField(source="company.registration_number")
    company_name = serializers.CharField(source="company.name")
    company_status = serializers.CharField(source="company.status")

    class Meta:
        model = Directorship
        fields = [
            "company_registration_number",
            "company_name",
            "company_status",
            "role",
            "shares",
            "appointed_on",
        ]


class CompanyOfficerSerializer(serializers.ModelSerializer[Directorship]):
    class Meta:
        model = Directorship
        fields = ["id_number", "full_name", "role", "shares", "appointed_on"]


class CompanySerializer(serializers.ModelSerializer[Company]):
    officers = CompanyOfficerSerializer(source="directorships", many=True, read_only=True)

    class Meta:
        model = Company
        fields = ["registration_number", "name", "status", "registered_on", "officers"]
