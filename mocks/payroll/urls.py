from django.urls import path

from payroll.views import InstructionCreate, InstructionDetail

urlpatterns = [
    path("payroll/v1/instructions", InstructionCreate.as_view(), name="payroll-instructions"),
    path(
        "payroll/v1/instructions/<str:instruction_reference>",
        InstructionDetail.as_view(),
        name="payroll-instruction",
    ),
]
