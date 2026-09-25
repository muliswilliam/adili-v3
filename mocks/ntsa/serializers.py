from rest_framework import serializers

from ntsa.models import Vehicle


class VehicleSerializer(serializers.ModelSerializer[Vehicle]):
    class Meta:
        model = Vehicle
        fields = [
            "registration_number",
            "make",
            "model",
            "year_of_manufacture",
            "owner_id_number",
            "registered_on",
        ]
