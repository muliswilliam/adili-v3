from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics

from iprs.models import Person
from iprs.serializers import PersonSerializer


@extend_schema_view(get=extend_schema(operation_id="getPerson"))
class PersonDetail(generics.RetrieveAPIView[Person]):
    """Identity lookup used to verify self-registration (ADR-004)."""

    queryset = Person.objects.all()
    serializer_class = PersonSerializer
    lookup_field = "id_number"
