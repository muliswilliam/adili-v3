from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics, status
from rest_framework.request import Request
from rest_framework.response import Response

from payroll.models import Instruction
from payroll.serializers import InstructionSerializer


class InstructionCreate(generics.GenericAPIView[Instruction]):
    """Receives a payroll instruction. Resubmitting the same reference returns the original."""

    serializer_class = InstructionSerializer

    @extend_schema(
        operation_id="submitInstruction",
        responses={200: InstructionSerializer, 201: InstructionSerializer},
    )
    def post(self, request: Request) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        existing = Instruction.objects.filter(
            instruction_reference=serializer.validated_data["instruction_reference"]
        ).first()
        if existing:
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@extend_schema_view(get=extend_schema(operation_id="getInstruction"))
class InstructionDetail(generics.RetrieveAPIView[Instruction]):
    queryset = Instruction.objects.all()
    serializer_class = InstructionSerializer
    lookup_field = "instruction_reference"


@extend_schema(exclude=True)
def status_page(request: HttpRequest) -> HttpResponse:
    """Demo page: acknowledgements for stop/resume instructions (spec 08)."""
    return render(
        request,
        "payroll/status.html",
        {"instructions": Instruction.objects.all()[:100]},
    )
