from rest_framework import serializers

from kra.models import Taxpayer


class TaxpayerSerializer(serializers.ModelSerializer[Taxpayer]):
    class Meta:
        model = Taxpayer
        fields = ["pin", "id_number", "name", "registered_on"]


class ComplianceSerializer(serializers.ModelSerializer[Taxpayer]):
    status = serializers.CharField(source="compliance_status")
    certificate_number = serializers.CharField(source="compliance_certificate_number")
    valid_until = serializers.DateField(source="compliance_valid_until", allow_null=True)

    class Meta:
        model = Taxpayer
        fields = ["pin", "status", "certificate_number", "valid_until", "annual_income_declared"]
