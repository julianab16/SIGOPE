from django.conf import settings
from django.db import models
from django.db.models import Q
from catalog.models import Equipment
from operational_reports.models import News  # Ajusta la ruta al módulo real


class Maintenance(models.Model):
    class MaintenanceType(models.TextChoices):
        PREVENTIVE = "preventivo", "Preventivo"
        CORRECTIVE = "correctivo", "Correctivo"

    class Priority(models.TextChoices):
        HIGH = "alta", "Alta"
        MEDIUM = "media", "Media"
        LOW = "baja", "Baja"

    class Status(models.TextChoices):
        SCHEDULED = "programado", "Programado"
        IN_PROGRESS = "en_ejecucion", "En ejecución"
        FINISHED = "finalizado", "Finalizado"
        CANCELLED = "cancelado", "Cancelado"

    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="maintenances")
    maintenance_type = models.CharField(max_length=20, choices=MaintenanceType.choices)
    scheduled_date = models.DateField()
    priority = models.CharField(max_length=10, choices=Priority.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    responsible_users = models.ManyToManyField(settings.AUTH_USER_MODEL, through="MaintenanceAssignment", through_fields=("maintenance", "user"), related_name="assigned_maintenances")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_maintenances")
    created_at = models.DateTimeField(auto_now_add=True)
    novedad = models.ForeignKey(News, on_delete=models.PROTECT, null=True, blank=True, related_name="maintenances",)
    cancellation_reason = models.TextField(blank=True)
    final_observations = models.TextField(blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    finished_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="finished_maintenances")

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


class MaintenanceStatusHistory(models.Model):
    maintenance = models.ForeignKey(Maintenance, on_delete=models.CASCADE, related_name="status_history")
    previous_status = models.CharField(max_length=20, choices=Maintenance.Status.choices)
    new_status = models.CharField(max_length=20, choices=Maintenance.Status.choices)
    changed_at = models.DateTimeField(auto_now_add=True)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reason = models.TextField(blank=True)

    class Meta:
        ordering = ("changed_at", "pk")


class MaintenanceActivity(models.Model):
    maintenance = models.ForeignKey(Maintenance, on_delete=models.CASCADE, related_name="activities")
    description = models.TextField()
    performed_on = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("performed_on", "pk")


class MaintenanceMaterial(models.Model):
    maintenance = models.ForeignKey(Maintenance, on_delete=models.CASCADE, related_name="materials")
    description = models.TextField()
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("pk",)
