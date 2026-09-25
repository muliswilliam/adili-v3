from rest_framework import serializers

from sms.models import Message


class MessageSerializer(serializers.ModelSerializer[Message]):
    to = serializers.RegexField(r"^\+254[17]\d{8}$", help_text="Kenyan mobile number in E.164")

    class Meta:
        model = Message
        fields = ["message_id", "to", "sender_id", "message", "status", "received_at"]
        read_only_fields = ["message_id", "status", "received_at"]
