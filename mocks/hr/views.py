from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from hr.models import Employment
from hr.serializers import Employee, EmployeeSerializer


class EmployeeDetail(APIView):
    """Employment history used to pre-fill bio data and verify employment claims."""

    @extend_schema(operation_id="getEmployee", responses=EmployeeSerializer)
    def get(self, _request: Request, id_number: str) -> Response:
        employments = list(Employment.objects.filter(id_number=id_number))
        if not employments:
            raise Http404
        employee = Employee(id_number, employments[0].full_name, employments)
        serializer = EmployeeSerializer(employee)
        return Response(serializer.data)
