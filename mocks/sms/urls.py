from django.urls import path

from sms.views import MessageDetail, MessageListCreate

urlpatterns = [
    path("sms", MessageListCreate.as_view(), name="sms-messages"),
    path("sms/<uuid:message_id>", MessageDetail.as_view(), name="sms-message"),
]
