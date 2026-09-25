from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics

from brs.models import Company, Directorship
from brs.serializers import CompanySerializer, PersonDirectorshipSerializer


@extend_schema_view(get=extend_schema(operation_id="listDirectorshipsByPerson"))
class PersonDirectorships(generics.ListAPIView[Directorship]):
    """Directorships and shareholdings held by a national ID number."""

    serializer_class = PersonDirectorshipSerializer

    def get_queryset(self) -> QuerySet[Directorship]:
        return Directorship.objects.select_related("company").filter(
            id_number=self.kwargs["id_number"]
        )


@extend_schema_view(get=extend_schema(operation_id="getCompany"))
class CompanyDetail(generics.RetrieveAPIView[Company]):
    queryset = Company.objects.prefetch_related("directorships")
    serializer_class = CompanySerializer
    lookup_field = "registration_number"
