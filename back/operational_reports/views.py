from rest_framework import viewsets
from rest_framework.permissions import SAFE_METHODS, BasePermission
from accounts.models import AccessLevel, Module, User
from accounts.permissions import HasModulePermission
from common.filters.operational import filter_operational_records
from rest_framework.exceptions import PermissionDenied
from django.contrib.contenttypes.models import ContentType
from .models import Evidence, Incident, News
from .serializers import EvidenceSerializer, IncidentSerializer, NewsSerializer


class OperationalReportViewSet(viewsets.ModelViewSet):
    permission_classes = (HasModulePermission,)
    module = Module.INCIDENTS

    def filter_for_user(self, queryset):
        user = self.request.user
        if not (user.is_admin or user.access_level(Module.INCIDENTS) == AccessLevel.VIEW):
            queryset = queryset.filter(reported_by=user)
        return queryset


class NewsViewSet(OperationalReportViewSet):
    serializer_class = NewsSerializer
    queryset = News.objects.select_related("equipment__equipment_type", "reported_by").order_by("-reported_at")

    def get_queryset(self):
        queryset = self.filter_for_user(super().get_queryset())
        tipo = self.request.query_params.get("tipo")
        if tipo:
            queryset = queryset.filter(type=tipo)
        return filter_operational_records(
            self.request,
            queryset,
            date_field="reported_at",
            operator_field="reported_by_id",
            statuses=News.Status.choices,
            state_field="status",
        )

    def perform_update(self, serializer):
        if serializer.instance.maintenances.filter(status="finalizado").exists():
            raise PermissionDenied("Una novedad atendida vinculada a un mantenimiento finalizado no puede editarse.")
        serializer.save()


class IncidentViewSet(OperationalReportViewSet):
    serializer_class = IncidentSerializer
    queryset = Incident.objects.select_related("equipment__equipment_type", "reported_by").order_by("-reported_at")

    def get_queryset(self):
        return filter_operational_records(
            self.request,
            self.filter_for_user(super().get_queryset()),
            date_field="reported_at",
            operator_field="reported_by_id",
            statuses=Incident.Status.choices,
            state_field="status",
            severities=Incident.Severity.choices,
            severity_field="severity",
        )

    def perform_update(self, serializer):
        user = self.request.user
        incident = serializer.instance
        if user.role == User.Role.OPERARIO and incident.reported_by_id == user.pk:
            raise PermissionDenied("No puedes editar un incidente después de reportarlo.")
        serializer.save()


class EvidencePermission(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return user.is_admin or any(
                user.access_level(module) in (AccessLevel.VIEW, AccessLevel.MANAGE)
                for module in (Module.INSPECTIONS, Module.INCIDENTS, Module.MAINTENANCE, Module.SST)
            )
        record_type = request.data.get("record_type")
        if record_type == "inspection":
            module = Module.INSPECTIONS
        elif record_type == "incident":
            module = Module.INCIDENTS
        elif record_type == "news":
            module = Module.INCIDENTS
        elif record_type == "maintenance":
            module = Module.MAINTENANCE
        else:
            return False
        return user.access_level(module) == AccessLevel.MANAGE


class EvidenceViewSet(viewsets.ModelViewSet):
    queryset = Evidence.objects.select_related("uploaded_by", "content_type")
    serializer_class = EvidenceSerializer
    permission_classes = (EvidencePermission,)
    http_method_names = ("get", "post", "head", "options")

    def get_queryset(self):
        user = self.request.user
        if user.is_admin:
            return self.queryset
        allowed_models = []
        if user.access_level(Module.INSPECTIONS) in (AccessLevel.VIEW, AccessLevel.MANAGE):
            allowed_models.append(("inspections", "inspection"))
        if user.access_level(Module.INCIDENTS) in (AccessLevel.VIEW, AccessLevel.MANAGE):
            allowed_models.extend((("operational_reports", "news"), ("operational_reports", "incident")))
        if any(user.access_level(module) in (AccessLevel.VIEW, AccessLevel.MANAGE) for module in (Module.MAINTENANCE, Module.SST)):
            allowed_models.append(("maintenance", "maintenance"))
        content_type_ids = [
            ContentType.objects.get_by_natural_key(app_label, model).pk
            for app_label, model in allowed_models
        ]
        return self.queryset.filter(content_type_id__in=content_type_ids)

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)
