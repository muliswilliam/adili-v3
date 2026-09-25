from django.urls import path

from brs.views import CompanyDetail, PersonDirectorships

urlpatterns = [
    path(
        "brs/v1/persons/<str:id_number>/directorships",
        PersonDirectorships.as_view(),
        name="brs-person-directorships",
    ),
    path(
        "brs/v1/companies/<str:registration_number>",
        CompanyDetail.as_view(),
        name="brs-company",
    ),
]
