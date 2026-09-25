from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics

from ardhisasa.models import Parcel
from ardhisasa.serializers import ParcelSerializer


@extend_schema_view(get=extend_schema(operation_id="listParcelsByOwner"))
class OwnerParcels(generics.ListAPIView[Parcel]):
    """Parcels registered to a national ID number; empty when there are none."""

    serializer_class = ParcelSerializer

    def get_queryset(self) -> QuerySet[Parcel]:
        return Parcel.objects.filter(owner_id_number=self.kwargs["id_number"])


@extend_schema_view(get=extend_schema(operation_id="getParcel"))
class ParcelDetail(generics.RetrieveAPIView[Parcel]):
    queryset = Parcel.objects.all()
    serializer_class = ParcelSerializer
    lookup_field = "parcel_number"
