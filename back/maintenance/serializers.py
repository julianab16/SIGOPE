from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from catalog.models import Equipment
from .models import Maintenance, MaintenanceAssignment, MaintenanceReschedule

User = get_user_model()


class RescheduleSerializer(serializers.Serializer):
    scheduled_date = serializers.DateField()
    reason = serializers.CharField()

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("El motivo de reprogramación es obligatorio.")
        return value.strip()


class AssignmentSerializer(serializers.Serializer):
    responsible_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)

    def validate_responsible_ids(self, values):
        if len(set(values)) != len(values):
            raise serializers.ValidationError("No repitas responsables.")
        users = User.objects.filter(pk__in=values, is_active=True)
        if users.count() != len(values):
            raise serializers.ValidationError("Todos los responsables deben existir y estar activos.")
        return list(users)


class MaintenanceSerializer(serializers.ModelSerializer):
    responsible_users = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = Maintenance
        fields = ("id", "equipment", "maintenance_type", "scheduled_date", "priority", "status", "responsible_users", "created_by", "created_at")
        read_only_fields = ("id", "status", "created_by", "created_at")

    def validate_equipment(self, value):
        if not Equipment.objects.filter(pk=value.pk).exists():
            raise serializers.ValidationError("El equipo no existe.")
        return value

    def create(self, validated_data):
        return Maintenance.objects.create(created_by=self.context["request"].user, **validated_data)
