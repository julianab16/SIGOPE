from rest_framework.routers import DefaultRouter
from .views import ActivityViewSet, MaintenanceViewSet, MaterialViewSet

router = DefaultRouter()
router.register("activities", ActivityViewSet, basename="maintenance-activities")
router.register("materials", MaterialViewSet, basename="maintenance-materials")
router.register("", MaintenanceViewSet, basename="maintenance")
urlpatterns = router.urls
