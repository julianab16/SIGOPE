from django.db import transaction
from django.db.models import Case, IntegerField, Value, When
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.models import Module
from accounts.permissions import HasModulePermission
from .models import Maintenance, MaintenanceAssignment, MaintenanceReschedule
from .serializers import AssignmentSerializer, MaintenanceSerializer, RescheduleSerializer


class MaintenanceViewSet(viewsets.ModelViewSet):
    serializer_class = MaintenanceSerializer
    permission_classes = (HasModulePermission,)
    module = Module.MAINTENANCE
    filterset_fields = ("equipment", "maintenance_type", "priority", "scheduled_date", "status")

    def get_queryset(self):
        return Maintenance.objects.select_related("equipment", "created_by").prefetch_related("responsible_users").annotate(priority_order=Case(When(priority="alta", then=Value(0)), When(priority="media", then=Value(1)), default=Value(2), output_field=IntegerField())).order_by("priority_order", "scheduled_date")

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        if "status" in request.data:
            if request.data["status"] == Maintenance.Status.IN_PROGRESS and not instance.responsible_users.filter(is_active=True).exists():
                raise ValidationError({"status": "Asigna al menos un responsable antes de iniciar el mantenimiento."})
            if request.data["status"] != Maintenance.Status.IN_PROGRESS:
                raise ValidationError({"status": "Transición de estado no permitida."})
            instance.status = Maintenance.Status.IN_PROGRESS
            instance.save(update_fields=("status",))
            return Response(self.get_serializer(instance).data)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=("post",))
    @transaction.atomic
    def reschedule(self, request, pk=None):
        maintenance = self.get_object()
        if maintenance.status == Maintenance.Status.IN_PROGRESS:
            raise ValidationError("No se puede reprogramar un mantenimiento en ejecución.")
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
        serializer = AssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        MaintenanceAssignment.objects.filter(maintenance=maintenance, active=True).update(active=False)
        MaintenanceAssignment.objects.bulk_create([MaintenanceAssignment(maintenance=maintenance, user=user, assigned_by=request.user) for user in serializer.validated_data["responsible_ids"]])
        return Response(self.get_serializer(maintenance).data)
