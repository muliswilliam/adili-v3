from django.urls import path

from icms.views import ReferralCreate, ReferralDetail, status_page

urlpatterns = [
    path("icms/status", status_page, name="icms-status"),
    path("icms/v1/referrals", ReferralCreate.as_view(), name="icms-referrals"),
    # Case numbers contain slashes, e.g. EACC/ICMS/2027/000123.
    path("icms/v1/referrals/<path:case_number>", ReferralDetail.as_view(), name="icms-referral"),
]
