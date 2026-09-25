from django.urls import path

from ntsa.views import OwnerVehicles, VehicleDetail

urlpatterns = [
    path(
        "ntsa/v1/owners/<str:id_number>/vehicles",
        OwnerVehicles.as_view(),
        name="ntsa-owner-vehicles",
    ),
    path(
        "ntsa/v1/vehicles/<str:registration_number>",
        VehicleDetail.as_view(),
        name="ntsa-vehicle",
    ),
]
