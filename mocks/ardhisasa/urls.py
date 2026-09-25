from django.urls import path

from ardhisasa.views import OwnerParcels, ParcelDetail

urlpatterns = [
    path(
        "ardhisasa/v1/owners/<str:id_number>/parcels",
        OwnerParcels.as_view(),
        name="ardhisasa-owner-parcels",
    ),
    # Parcel numbers contain slashes, e.g. NAIROBI/BLOCK82/1234.
    path(
        "ardhisasa/v1/parcels/<path:parcel_number>", ParcelDetail.as_view(), name="ardhisasa-parcel"
    ),
]
