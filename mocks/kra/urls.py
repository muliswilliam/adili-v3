from django.urls import path

from kra.views import TaxpayerCompliance, TaxpayerDetail, TaxpayerList

urlpatterns = [
    path("kra/v1/pins", TaxpayerList.as_view(), name="kra-pins"),
    path("kra/v1/pins/<str:pin>", TaxpayerDetail.as_view(), name="kra-pin"),
    path(
        "kra/v1/pins/<str:pin>/compliance",
        TaxpayerCompliance.as_view(),
        name="kra-pin-compliance",
    ),
]
