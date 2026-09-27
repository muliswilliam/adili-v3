from django.db.models import QuerySet
from django.http import Http404, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics

from sms.models import Message
from sms.otp import otp_from_message
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


@extend_schema(exclude=True)
def inbox(request: HttpRequest) -> HttpResponse:
    """HTML inbox so the live demo can read OTPs the way Mailpit is used for email."""
    to = request.GET.get("to", "").strip()
    messages = Message.objects.all()
    if to:
        messages = messages.filter(to=to)
    rows = [{"record": record, "otp": otp_from_message(record)} for record in messages[:100]]
    return render(
        request,
        "sms/inbox.html",
        {"messages": rows, "to": to},
    )


@extend_schema(exclude=True)
def latest_otp(request: HttpRequest) -> JsonResponse:
    """Latest 6-digit code sent to `?to=`, for demo scripts and onboarding tests."""
    to = request.GET.get("to", "").strip()
    if not to:
        return JsonResponse({"detail": "Query parameter to is required"}, status=400)
    for record in Message.objects.filter(to=to):
        code = otp_from_message(record)
        if code:
            return JsonResponse(
                {
                    "to": record.to,
                    "code": code,
                    "message_id": str(record.message_id),
                    "received_at": record.received_at.isoformat(),
                }
            )
    raise Http404("No OTP for this number")
