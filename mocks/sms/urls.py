from django.urls import path

from sms.views import MessageDetail, MessageListCreate, inbox, latest_otp

urlpatterns = [
    path("sms", MessageListCreate.as_view(), name="sms-messages"),
    path("sms/inbox", inbox, name="sms-inbox"),
    path("sms/otp", latest_otp, name="sms-otp"),
    path("sms/<uuid:message_id>", MessageDetail.as_view(), name="sms-message"),
]
