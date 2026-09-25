from django.urls import path

from iprs.views import PersonDetail

urlpatterns = [
    path("iprs/v1/persons/<str:id_number>", PersonDetail.as_view(), name="iprs-person"),
]
