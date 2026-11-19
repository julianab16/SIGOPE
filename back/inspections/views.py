from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.permissions import BasePermission, SAFE_METHODS
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.models import AccessLevel, Module, User
from accounts.permissions import HasAnyReadModulePermission, HasModulePermission
from common.filters.operational import filter_operational_records

from .models import EquipmentCheckIn, Evidence, Inspection
from .serializers import CheckInCloseSerializer, CheckInSerializer, EvidenceSerializer, InspectionSerializer

# Roles que supervisan y por eso ven las inspecciones de todos.
SUPERVISOR_ROLES = (User.Role.ADMINISTRADOR, User.Role.JEFE_TALLER, User.Role.SST)


class InspectionViewSet(viewsets.ModelViewSet):
    queryset = Inspection.objects.select_related(
        "equipment", "checklist", "performed_by"
    ).prefetch_related("responses__item__category")
    serializer_class = InspectionSerializer
    permission_classes = (HasAnyReadModulePermission,)
    module = Module.INSPECTIONS
    read_modules = (Module.INSPECTIONS, Module.SST)
    filterset_fields = ("equipment", "checklist", "status", "performed_by")
    ordering_fields = ("performed_at",)
    ordering = ("-performed_at",)

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        sees_all = (
            user.is_admin
            or user.role in SUPERVISOR_ROLES
            or user.access_level(Module.INSPECTIONS) == AccessLevel.VIEW
        )
        queryset = queryset if sees_all else queryset.filter(performed_by=user)
        return filter_operational_records(
            self.request, queryset, statuses=Inspection.Status.choices, critical_filter=True
        )


class CheckInViewSet(viewsets.ModelViewSet):
    serializer_class = CheckInSerializer
    permission_classes = (HasModulePermission,)
    module = Module.INSPECTIONS
    http_method_names = ("get", "post", "head", "options")

    def get_queryset(self):
        queryset = EquipmentCheckIn.objects.select_related("equipment", "equipment__equipment_type", "operator")
        if self.request.user.is_admin or self.request.user.access_level(Module.INSPECTIONS) == AccessLevel.VIEW:
            return queryset
        return queryset.filter(operator=self.request.user)

    @transaction.atomic
    def perform_create(self, serializer):
        equipment = serializer.validated_data["equipment"]
        # Serialize concurrent attempts against the same equipment row.
        from catalog.models import Equipment
        equipment = Equipment.objects.select_for_update().get(pk=equipment.pk)
        if equipment.status != Equipment.Status.USABLE:
            raise ValidationError({"equipment": "El equipo no está disponible."})
        if EquipmentCheckIn.objects.filter(equipment=equipment, closed_at__isnull=True).exists():
            raise ValidationError({"equipment": "El equipo ya tiene un check-in abierto."})
        serializer.save(equipment=equipment)

    @extend_schema(request=CheckInCloseSerializer, responses=CheckInSerializer)
    @action(detail=True, methods=("post",))
    @transaction.atomic
    def close(self, request, pk=None):
        checkin = self.get_object()
        if checkin.operator_id != request.user.pk:
            raise ValidationError("Solo el operario que inició el uso puede cerrarlo.")
        if checkin.closed_at:
            raise ValidationError("El check-in ya está cerrado.")
        cierre = CheckInCloseSerializer(data=request.data, context={"checkin": checkin})
        cierre.is_valid(raise_exception=True)
        try:
            checkin.hour_meter_end = cierre.validated_data["hour_meter_end"]
            checkin.closed_at = timezone.now()
            checkin.save(update_fields=("hour_meter_end", "closed_at"))
        except IntegrityError as exc:
            raise ValidationError("No se pudo cerrar el check-in.") from exc
        return Response(self.get_serializer(checkin).data, status=status.HTTP_200_OK)


class EvidenceViewSet(viewsets.ModelViewSet):
    queryset = Evidence.objects.select_related("uploaded_by", "content_type")
    serializer_class = EvidenceSerializer
    http_method_names = ("get", "post", "head", "options")

    def get_permissions(self):
        class EvidencePermission(BasePermission):
            def has_permission(permission_self, request, view):
                user = request.user
                if not (user and user.is_authenticated):
                    return False
                if request.method in SAFE_METHODS:
                    return user.is_admin or any(
                        user.access_level(module) in (AccessLevel.VIEW, AccessLevel.MANAGE)
                        for module in (Module.INSPECTIONS, Module.INCIDENTS)
                    )
                record_type = request.data.get("record_type")
                module = Module.INSPECTIONS if record_type == "inspection" else Module.INCIDENTS
                return user.access_level(module) == AccessLevel.MANAGE

        return [EvidencePermission()]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)
