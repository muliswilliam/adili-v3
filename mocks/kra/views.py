from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics

from kra.models import Taxpayer
from kra.serializers import ComplianceSerializer, TaxpayerSerializer


@extend_schema_view(get=extend_schema(operation_id="findTaxpayersByIdNumber"))
class TaxpayerList(generics.ListAPIView[Taxpayer]):
    """PIN lookup by national ID number (`?id_number=`)."""

    serializer_class = TaxpayerSerializer

    def get_queryset(self) -> QuerySet[Taxpayer]:
        id_number = self.request.query_params.get("id_number")
        if not id_number:
            return Taxpayer.objects.none()
        return Taxpayer.objects.filter(id_number=id_number)


@extend_schema_view(get=extend_schema(operation_id="getTaxpayer"))
class TaxpayerDetail(generics.RetrieveAPIView[Taxpayer]):
    queryset = Taxpayer.objects.all()
    serializer_class = TaxpayerSerializer
    lookup_field = "pin"


@extend_schema_view(get=extend_schema(operation_id="getTaxCompliance"))
class TaxpayerCompliance(generics.RetrieveAPIView[Taxpayer]):
    """Tax compliance status and declared income, used in declaration cross-checks."""

    queryset = Taxpayer.objects.all()
    serializer_class = ComplianceSerializer
    lookup_field = "pin"
