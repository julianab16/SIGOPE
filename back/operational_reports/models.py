from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.validators import FileExtensionValidator
from django.db import models

from catalog.models import Equipment


class News(models.Model):
    class Status(models.TextChoices):
        LEGACY_REPORTED = "repostado", "Reportado"
        REPORTED = "reported", "Reportado"
        IN_REVIEW = "in_review", "En revisión"
        RESOLVED = "resolved", "Atendido"
        CLOSED = "closed", "Cerrado"

    class Type(models.TextChoices):
        MECHANICAL_FAILURE = "mechanical_failure", "Falla mecánica"
        UNSAFE_CONDITION = "unsafe_condition", "Condición insegura"
        DAMAGE = "damage", "Daño"
        ENVIRONMENTAL = "environmental", "Observación ambiental"

    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="operational_news")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="operational_news")
    reported_at = models.DateTimeField(auto_now_add=True)
    type = models.CharField(max_length=30, choices=Type.choices, default=Type.DAMAGE)
    description = models.TextField(default="")
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REPORTED)


class Incident(models.Model):
    class Status(models.TextChoices):
        LEGACY_REPORTED = "repostado", "Reportado"
        REPORTED = "reported", "Reportado"
        IN_REVIEW = "in_review", "En revisión"
        IN_PROGRESS = "in_progress", "En atención"
        RESOLVED = "resolved", "Resuelto"
        CLOSED = "closed", "Cerrado"

    class Severity(models.TextChoices):
        LOW = "leve", "Leve"
        MEDIUM = "media", "Media"
        HIGH = "grave", "Grave"

    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="operational_incidents")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="operational_incidents")
    reported_at = models.DateTimeField(auto_now_add=True)
    occurred_at = models.DateTimeField()
    description = models.TextField(default="")
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REPORTED)
    severity = models.CharField(max_length=20, choices=Severity.choices, default=Severity.LOW)


def evidence_upload_path(instance, filename):
    return f"evidence/{instance.content_type.model}/{instance.object_id}/{filename}"


class Evidence(models.Model):
    MAX_SIZE = 5 * 1024 * 1024
    ALLOWED_EXTENSIONS = ("jpg", "jpeg", "png", "pdf")

    content_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE, related_name="operational_evidence"
    )
    object_id = models.PositiveBigIntegerField()
    target = GenericForeignKey("content_type", "object_id")
    file = models.FileField(
        upload_to=evidence_upload_path,
        validators=[FileExtensionValidator(allowed_extensions=ALLOWED_EXTENSIONS)],
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="uploaded_operational_evidence",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("uploaded_at",)
