from rest_framework import serializers

from icms.models import Referral


class ReferralSerializer(serializers.ModelSerializer[Referral]):
    class Meta:
        model = Referral
        fields = [
            "case_number",
            "referral_reference",
            "id_number",
            "full_name",
            "referring_commission",
            "grounds",
            "details",
            "status",
            "registered_at",
        ]
        read_only_fields = ["case_number", "status", "registered_at"]
        # Uniqueness is handled by the view so resubmissions return the original.
        extra_kwargs: dict[str, dict[str, object]] = {"referral_reference": {"validators": []}}
