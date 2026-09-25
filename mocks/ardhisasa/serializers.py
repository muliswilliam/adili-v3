from rest_framework import serializers

from ardhisasa.models import Parcel


class ParcelSerializer(serializers.ModelSerializer[Parcel]):
    class Meta:
        model = Parcel
        fields = [
            "parcel_number",
            "county",
            "area_hectares",
            "tenure",
            "owner_id_number",
            "registered_on",
        ]
