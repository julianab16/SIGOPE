from django.conf import settings
from django.db import models
from catalog.models import Equipment


class Incidents(models.Model):

    class Estados(models.TextChoices):
        REPORT = "repostado", "Reportado"

    class Severidad(models.TextChoices):
        CRITICA = "grave", "Grave"
        LEVE = "leve", "Leve"

    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="incidents")
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="reported_incidents")
    performed_at = models.DateTimeField(auto_now_add=True)
    general_notes = models.TextField(blank=True)
    estado = models.CharField(max_length=20, choices=Estados.choices, blank=True)
    severidad = models.CharField(max_length=20, choices=Severidad.choices, blank=True)

