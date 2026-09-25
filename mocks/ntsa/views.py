from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics

from ntsa.models import Vehicle
from ntsa.serializers import VehicleSerializer


@extend_schema_view(get=extend_schema(operation_id="listVehiclesByOwner"))
class OwnerVehicles(generics.ListAPIView[Vehicle]):
    """Vehicles registered to a national ID number; empty when there are none."""

    serializer_class = VehicleSerializer

    def get_queryset(self) -> QuerySet[Vehicle]:
        return Vehicle.objects.filter(owner_id_number=self.kwargs["id_number"])


@extend_schema_view(get=extend_schema(operation_id="getVehicle"))
class VehicleDetail(generics.RetrieveAPIView[Vehicle]):
    queryset = Vehicle.objects.all()
    serializer_class = VehicleSerializer
    lookup_field = "registration_number"
