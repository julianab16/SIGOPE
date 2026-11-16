from rest_framework import serializers

from .models import News


class NewsSerializer(serializers.ModelSerializer):
    equipment_code = serializers.CharField(source="equipment.identifier", read_only=True)
    equipment_type = serializers.CharField(source="equipment.equipment_type.name", read_only=True)
    reporter_id = serializers.IntegerField(source="performed_by_id", read_only=True)
    reporter_name = serializers.CharField(source="performed_by.full_name", read_only=True)

    class Meta:
        model = News
        fields = ("id", "equipment", "equipment_code", "equipment_type", "performed_by", "reporter_id", "reporter_name", "performed_at", "estado", "general_notes")
