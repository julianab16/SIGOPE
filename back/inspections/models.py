from django.conf import settings
from django.db import models
from django.db.models import Q

from catalog.models import Equipment, InspectionChecklist


class EquipmentCheckIn(models.Model):
    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="checkins")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="equipment_checkins")
    hour_meter_start = models.DecimalField(max_digits=12, decimal_places=2)
    hour_meter_end = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    checked_in_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("equipment",), condition=Q(closed_at__isnull=True), name="unique_open_equipment_checkin")]
        ordering = ("-checked_in_at",)


class Inspection(models.Model):
    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "En progreso"
        COMPLETED = "completed", "Completada"

    class GlobalResult(models.TextChoices):
        CRITICAL_FAILURE = "critical_failure", "Con falla crítica"
        COMPLETED = "completed", "Completada"

    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="inspections")
    checklist = models.ForeignKey(
        InspectionChecklist, on_delete=models.PROTECT, related_name="inspections"
    )
    checklist_version = models.PositiveIntegerField()
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    checkin = models.OneToOneField(EquipmentCheckIn, on_delete=models.PROTECT, related_name="inspection", null=True, blank=True)
    performed_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    general_notes = models.TextField(blank=True)
    global_result = models.CharField(max_length=30, choices=GlobalResult.choices, blank=True)


class InspectionResponse(models.Model):
    class Result(models.TextChoices):
        COMPLIES = "complies", "Cumple"
        DOES_NOT_COMPLY = "does_not_comply", "No cumple"
        NOT_APPLICABLE = "not_applicable", "No aplica"

    inspection = models.ForeignKey(Inspection, on_delete=models.CASCADE, related_name="responses")
    item = models.ForeignKey("catalog.ChecklistItem", on_delete=models.PROTECT)
    result = models.CharField(max_length=20, choices=Result.choices)
    notes = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("inspection", "item"), name="unique_inspection_response")
        ]
