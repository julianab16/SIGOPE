from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Case, IntegerField, Value, When
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from accounts.models import Module
from accounts.permissions import HasModulePermission
from catalog.models import Equipment
from operational_reports.models import Evidence, News
from .models import (Maintenance, MaintenanceActivity, MaintenanceAssignment, MaintenanceMaterial, MaintenanceReschedule, MaintenanceStatusHistory,)
from .serializers import (ActivitySerializer, AssignmentSerializer, FinishSerializer, MaintenanceSerializer, MaterialSerializer, RescheduleSerializer, StatusChangeSerializer,)


class MaintenanceViewSet(viewsets.ModelViewSet):
    serializer_class = MaintenanceSerializer
    permission_classes = (HasModulePermission,)
    module = Module.MAINTENANCE
    filterset_fields = ("equipment", "maintenance_type", "priority", "scheduled_date", "status")

    def get_queryset(self):
        return Maintenance.objects.select_related("equipment", "created_by", "novedad", "finished_by").prefetch_related(
            "responsible_users", "activities", "materials", "status_history__changed_by"
        ).annotate(
            priority_order=Case(When(priority="alta", then=Value(0)), When(priority="media", then=Value(1)), default=Value(2), output_field=IntegerField())
        ).order_by("priority_order", "scheduled_date")

    def _ensure_open(self, maintenance):
        if maintenance.status in (Maintenance.Status.FINISHED, Maintenance.Status.CANCELLED):
            raise ValidationError("El mantenimiento está cerrado y no admite modificaciones.")

    def partial_update(self, request, *args, **kwargs):
        if "status" in request.data:
            raise ValidationError({"status": "Usa la operación /status/ para cambiar el estado."})
        return super().partial_update(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if "status" in request.data:
            raise ValidationError({"status": "Usa la operación /status/ para cambiar el estado."})
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        maintenance = self.get_object()
        self._ensure_open(maintenance)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=("post",))
    @transaction.atomic
    def status(self, request, pk=None):
        maintenance = self.get_object()
        self._ensure_open(maintenance)
        serializer = StatusChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]
        allowed = {
            Maintenance.Status.SCHEDULED: (Maintenance.Status.IN_PROGRESS, Maintenance.Status.CANCELLED),
            Maintenance.Status.IN_PROGRESS: (Maintenance.Status.CANCELLED,),
        }
        if new_status not in allowed.get(maintenance.status, ()):
            raise ValidationError({"status": "Transición no permitida."})
        if new_status == Maintenance.Status.IN_PROGRESS and not maintenance.responsible_users.filter(is_active=True).exists():
            raise ValidationError({"status": "Asigna al menos un responsable activo antes de iniciar."})
        previous = maintenance.status
        maintenance.status = new_status
        if new_status == Maintenance.Status.CANCELLED:
            maintenance.cancellation_reason = serializer.validated_data["reason"]
        maintenance.save(update_fields=("status", "cancellation_reason"))
        if new_status == Maintenance.Status.IN_PROGRESS:
            equipment = Equipment.objects.get(pk=maintenance.equipment_id)
            equipment.status = Equipment.Status.MAINTENANCE
            equipment.save(update_fields=("status",))
        MaintenanceStatusHistory.objects.create(
            maintenance=maintenance, previous_status=previous, new_status=new_status,
            changed_by=request.user, reason=serializer.validated_data["reason"],
        )
        return Response(self.get_serializer(maintenance).data)

    @action(detail=True, methods=("post",))
    @transaction.atomic
    def finish(self, request, pk=None):
        maintenance = self.get_object()
        self._ensure_open(maintenance)
        if maintenance.status != Maintenance.Status.IN_PROGRESS:
            raise ValidationError({"status": "Solo se puede finalizar un mantenimiento en ejecución."})
        if not maintenance.activities.exists():
            raise ValidationError({"activities": "Registra al menos una actividad antes de finalizar."})
        serializer = FinishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        previous = maintenance.status
        maintenance.status = Maintenance.Status.FINISHED
        maintenance.final_observations = serializer.validated_data["final_observations"].strip()
        maintenance.finished_at = timezone.now()
        maintenance.finished_by = request.user
        maintenance.save(update_fields=("status", "final_observations", "finished_at", "finished_by"))
        equipment_status = Equipment.Status.NOT_USABLE if serializer.validated_data["out_of_service"] else Equipment.Status.USABLE
        equipment = Equipment.objects.get(pk=maintenance.equipment_id)
        equipment.status = equipment_status
        equipment.save(update_fields=("status",))
        if maintenance.novedad_id:
            News.objects.filter(pk=maintenance.novedad_id).update(status=News.Status.RESOLVED)
        MaintenanceStatusHistory.objects.create(
            maintenance=maintenance, previous_status=previous, new_status=Maintenance.Status.FINISHED,
            changed_by=request.user, reason=maintenance.final_observations,
        )
        return Response(self.get_serializer(maintenance).data)

    @action(detail=True, methods=("post",))
    @transaction.atomic
    def reschedule(self, request, pk=None):
        maintenance = self.get_object()
        self._ensure_open(maintenance)
        serializer = RescheduleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_date = serializer.validated_data["scheduled_date"]
        if new_date == maintenance.scheduled_date:
            raise ValidationError({"scheduled_date": "La nueva fecha debe ser diferente."})
        MaintenanceReschedule.objects.create(maintenance=maintenance, previous_date=maintenance.scheduled_date, new_date=new_date, reason=serializer.validated_data["reason"], changed_by=request.user)
        maintenance.scheduled_date = new_date
        maintenance.save(update_fields=("scheduled_date",))
        return Response(self.get_serializer(maintenance).data)

    @action(detail=True, methods=("put",))
    @transaction.atomic
    def assign(self, request, pk=None):
        maintenance = self.get_object()
        self._ensure_open(maintenance)
        serializer = AssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        MaintenanceAssignment.objects.filter(maintenance=maintenance, active=True).update(active=False)
        MaintenanceAssignment.objects.bulk_create([MaintenanceAssignment(maintenance=maintenance, user=user, assigned_by=request.user) for user in serializer.validated_data["responsible_ids"]])
        return Response(self.get_serializer(maintenance).data)

    @action(detail=False, methods=("get",), url_path=r"equipment/(?P<equipment_id>[^/.]+)/history")
    def equipment_history(self, request, equipment_id=None):
        if not Equipment.objects.filter(pk=equipment_id).exists():
            from rest_framework.exceptions import NotFound
            raise NotFound("El equipo no existe.")
        queryset = self.get_queryset().filter(equipment_id=equipment_id).order_by("-scheduled_date", "-created_at")
        start = request.query_params.get("date_from")
        end = request.query_params.get("date_to")
        kind = request.query_params.get("maintenance_type")
        try:
            start_date = serializers.DateField().run_validation(start) if start else None
            end_date = serializers.DateField().run_validation(end) if end else None
        except Exception as exc:
            raise ValidationError({"date": "Formato de fecha inválido. Usa YYYY-MM-DD."}) from exc
        if start_date and end_date and start_date > end_date:
            raise ValidationError({"date_from": "La fecha inicial no puede ser posterior a la fecha final."})
        if start_date:
            queryset = queryset.filter(scheduled_date__gte=start_date)
        if end_date:
            queryset = queryset.filter(scheduled_date__lte=end_date)
        if kind:
            if kind not in Maintenance.MaintenanceType.values:
                raise ValidationError({"maintenance_type": "Tipo de mantenimiento inválido."})
            queryset = queryset.filter(maintenance_type=kind)
        return Response(self.get_serializer(queryset, many=True).data)


class MaintenanceChildViewSet(viewsets.ModelViewSet):
    permission_classes = (HasModulePermission,)
    module = Module.MAINTENANCE
    filterset_fields = ("maintenance",)
    parent_model = Maintenance
    parent_kwarg = "maintenance"

    def get_queryset(self):
        return super().get_queryset().select_related("maintenance")

    def perform_create(self, serializer):
        parent_id = self.request.data.get("maintenance")
        try:
            parent = Maintenance.objects.get(pk=parent_id)
        except Maintenance.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("El mantenimiento no existe.")
        if parent.status in (Maintenance.Status.FINISHED, Maintenance.Status.CANCELLED):
            raise ValidationError("El mantenimiento está cerrado.")
        serializer.save(maintenance=parent)

    def perform_update(self, serializer):
        if serializer.instance.maintenance.status in (Maintenance.Status.FINISHED, Maintenance.Status.CANCELLED):
            raise ValidationError("El mantenimiento está cerrado.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.maintenance.status in (Maintenance.Status.FINISHED, Maintenance.Status.CANCELLED):
            raise ValidationError("El mantenimiento está cerrado.")
        instance.delete()

class ActivityViewSet(MaintenanceChildViewSet):
    serializer_class = ActivitySerializer
    queryset = MaintenanceActivity.objects.all()


class MaterialViewSet(MaintenanceChildViewSet):
    serializer_class = MaterialSerializer
    queryset = MaintenanceMaterial.objects.all()
