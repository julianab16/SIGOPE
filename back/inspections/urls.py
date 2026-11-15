from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CheckInViewSet, InspectionViewSet

router = DefaultRouter()
router.register("records", InspectionViewSet, basename="inspection")
router.register("checkins", CheckInViewSet, basename="checkin")

urlpatterns = [path("", include(router.urls))]
