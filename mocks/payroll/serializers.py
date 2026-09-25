from rest_framework import serializers

from payroll.models import Instruction


class InstructionSerializer(serializers.ModelSerializer[Instruction]):
    class Meta:
        model = Instruction
        fields = [
            "payroll_reference",
            "instruction_reference",
            "employer_code",
            "personal_number",
            "id_number",
            "action",
            "reason",
            "effective_date",
            "status",
            "received_at",
        ]
        read_only_fields = ["payroll_reference", "status", "received_at"]
        # Uniqueness is handled by the view so resubmissions return the original.
        extra_kwargs: dict[str, dict[str, object]] = {"instruction_reference": {"validators": []}}
