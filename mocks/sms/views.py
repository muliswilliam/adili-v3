from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics

from sms.models import Message
from sms.serializers import MessageSerializer


@extend_schema_view(
    get=extend_schema(operation_id="listMessages"), post=extend_schema(operation_id="sendMessage")
)
class MessageListCreate(generics.ListCreateAPIView[Message]):
    """Send an SMS, or list sent messages (optionally `?to=`) to inspect them in demos."""

    serializer_class = MessageSerializer

    def get_queryset(self) -> QuerySet[Message]:
        messages = Message.objects.all()
        to = self.request.query_params.get("to")
        return messages.filter(to=to) if to else messages[:100]


@extend_schema_view(get=extend_schema(operation_id="getMessage"))
class MessageDetail(generics.RetrieveAPIView[Message]):
    queryset = Message.objects.all()
    serializer_class = MessageSerializer
    lookup_field = "message_id"
