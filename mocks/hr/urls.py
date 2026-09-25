from django.urls import path

from hr.views import EmployeeDetail

urlpatterns = [
    path("hr/v1/employees/<str:id_number>", EmployeeDetail.as_view(), name="hr-employee"),
]
