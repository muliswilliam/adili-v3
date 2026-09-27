from django.urls import path

from hr.views import EmployeeDetail, EmployerSuppliers

urlpatterns = [
    path("hr/v1/employees/<str:id_number>", EmployeeDetail.as_view(), name="hr-employee"),
    path(
        "hr/v1/employers/<str:employer_code>/suppliers",
        EmployerSuppliers.as_view(),
        name="hr-employer-suppliers",
    ),
]
