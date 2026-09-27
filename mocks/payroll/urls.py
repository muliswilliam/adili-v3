from django.urls import path

from payroll.views import InstructionCreate, InstructionDetail, status_page

urlpatterns = [
    path("payroll/status", status_page, name="payroll-status"),
    path("payroll/v1/instructions", InstructionCreate.as_view(), name="payroll-instructions"),
    path(
        "payroll/v1/instructions/<str:instruction_reference>",
        InstructionDetail.as_view(),
        name="payroll-instruction",
    ),
]
