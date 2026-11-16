from django.conf import settings
from django.db import models
from catalog.models import Equipment

class News(models.Model):
    class Estados(models.TextChoices):
        REPORT = "repostado", "Reportado"

    equipment = models.ForeignKey(Equipment, on_delete=models.PROTECT, related_name="news")
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="reported_news")
    performed_at = models.DateTimeField(auto_now_add=True)
    general_notes = models.TextField(blank=True)
    estado = models.CharField(max_length=20, choices=Estados.choices, blank=True)


