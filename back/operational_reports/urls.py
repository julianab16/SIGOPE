from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import EvidenceViewSet, IncidentViewSet, NewsViewSet

router = DefaultRouter()
router.register("news", NewsViewSet, basename="operational-news")
router.register("incidents", IncidentViewSet, basename="operational-incident")
router.register("evidence", EvidenceViewSet, basename="operational-evidence")

urlpatterns = [path("", include(router.urls))]
