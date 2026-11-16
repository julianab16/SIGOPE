from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CheckInViewSet, EvidenceViewSet, InspectionViewSet

router = DefaultRouter()
router.register("records", InspectionViewSet, basename="inspection")
router.register("checkins", CheckInViewSet, basename="checkin")
router.register("evidence", EvidenceViewSet, basename="evidence")

urlpatterns = [path("", include(router.urls))]
