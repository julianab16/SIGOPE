from django.conf import settings
from django.db import models
from django.db.models import Q

from catalog.models import Equipment


class Maintenance(models.Model):
    class MaintenanceType(models.TextChoices):
        PREVENTIVE = "preventivo", "Preventivo"

    class Priority(models.TextChoices):
        HIGH = "alta", "Alta"
        MEDIUM = "media", "Media"
        LOW = "baja", "Baja"

    class Status(models.TextChoices):
        SCHEDULED = "programado", "Programado"
        IN_PROGRESS = "en_ejecucion", "En ejecución"

    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="maintenances")
    maintenance_type = models.CharField(max_length=20, choices=MaintenanceType.choices)
    scheduled_date = models.DateField()
    priority = models.CharField(max_length=10, choices=Priority.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    responsible_users = models.ManyToManyField(settings.AUTH_USER_MODEL, through="MaintenanceAssignment", through_fields=("maintenance", "user"), related_name="assigned_maintenances")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_maintenances")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("priority", "scheduled_date")


class MaintenanceReschedule(models.Model):
    maintenance = models.ForeignKey(Maintenance, on_delete=models.CASCADE, related_name="reschedules")
    previous_date = models.DateField()
    new_date = models.DateField()
    reason = models.TextField()
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    changed_at = models.DateTimeField(auto_now_add=True)


class MaintenanceAssignment(models.Model):
    maintenance = models.ForeignKey(Maintenance, on_delete=models.CASCADE, related_name="assignments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="maintenance_assignment_changes")
    assigned_at = models.DateTimeField(auto_now_add=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("maintenance", "user"), condition=Q(active=True), name="unique_active_maintenance_assignment")]
