from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics, status
from rest_framework.request import Request
from rest_framework.response import Response

from icms.models import Referral
from icms.serializers import ReferralSerializer


class ReferralCreate(generics.GenericAPIView[Referral]):
    """Registers a referral (Reg 20(2)) and returns the ICMS case number."""

    serializer_class = ReferralSerializer

    @extend_schema(
        operation_id="submitReferral", responses={200: ReferralSerializer, 201: ReferralSerializer}
    )
    def post(self, request: Request) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        existing = Referral.objects.filter(
            referral_reference=serializer.validated_data["referral_reference"]
        ).first()
        if existing:
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@extend_schema_view(get=extend_schema(operation_id="getReferral"))
class ReferralDetail(generics.RetrieveAPIView[Referral]):
    queryset = Referral.objects.all()
    serializer_class = ReferralSerializer
    lookup_field = "case_number"
