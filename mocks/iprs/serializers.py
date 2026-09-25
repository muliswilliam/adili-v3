from rest_framework import serializers

from iprs.models import Person


class PersonSerializer(serializers.ModelSerializer[Person]):
    class Meta:
        model = Person
        fields = [
            "id_number",
            "first_name",
            "middle_name",
            "last_name",
            "date_of_birth",
            "sex",
            "place_of_birth",
            "date_of_issue",
        ]
