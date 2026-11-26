from django.contrib.auth import get_user_model
from rest_framework import serializers

from catalog.models import Equipment
from operational_reports.models import Evidence
from .models import (
    Maintenance, MaintenanceActivity, MaintenanceAssignment, MaintenanceMaterial,
    MaintenanceReschedule, MaintenanceStatusHistory,
)

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


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=(Maintenance.Status.IN_PROGRESS, Maintenance.Status.CANCELLED))
    reason = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["status"] == Maintenance.Status.CANCELLED and not attrs["reason"].strip():
            raise serializers.ValidationError({"reason": "El motivo de cancelación es obligatorio."})
        attrs["reason"] = attrs["reason"].strip()
        return attrs


class FinishSerializer(serializers.Serializer):
    final_observations = serializers.CharField(required=False, allow_blank=True, default="")
    out_of_service = serializers.BooleanField(default=False)


class ActivitySerializer(serializers.ModelSerializer):
    maintenance = serializers.PrimaryKeyRelatedField(read_only=True)
    class Meta:
        model = MaintenanceActivity
        fields = ("id", "maintenance", "description", "performed_on", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("La descripción es obligatoria.")
        return value.strip()


class MaterialSerializer(serializers.ModelSerializer):
    maintenance = serializers.PrimaryKeyRelatedField(read_only=True)
    class Meta:
        model = MaintenanceMaterial
        fields = ("id", "maintenance", "description", "quantity", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("La descripción es obligatoria.")
        return value.strip()

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("La cantidad debe ser positiva.")
        return value


class StatusHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.full_name", read_only=True)

    class Meta:
        model = MaintenanceStatusHistory
        fields = ("previous_status", "new_status", "changed_at", "changed_by", "changed_by_name", "reason")


class EvidenceSummarySerializer(serializers.ModelSerializer):
    url = serializers.FileField(source="file", read_only=True)
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True)

    class Meta:
        model = Evidence
        fields = ("id", "url", "uploaded_by", "uploaded_by_name", "uploaded_at")


class MaintenanceSerializer(serializers.ModelSerializer):
    responsible_users = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    activities = ActivitySerializer(many=True, read_only=True)
    materials = MaterialSerializer(many=True, read_only=True)
    status_history = StatusHistorySerializer(many=True, read_only=True)
    evidences = serializers.SerializerMethodField()

    class Meta:
        model = Maintenance
        fields = (
            "id", "equipment", "maintenance_type", "scheduled_date", "priority", "status",
            "responsible_users", "created_by", "created_at", "novedad", "cancellation_reason",
            "final_observations", "finished_at", "finished_by", "activities", "materials",
            "status_history", "evidences",
        )
        read_only_fields = (
            "id", "status", "created_by", "created_at", "cancellation_reason",
            "final_observations", "finished_at", "finished_by",
        )

    def get_evidences(self, instance):
        from django.contrib.contenttypes.models import ContentType
        ct = ContentType.objects.get_for_model(Maintenance)
        return EvidenceSummarySerializer(
            Evidence.objects.filter(content_type=ct, object_id=instance.pk).select_related("uploaded_by"),
            many=True, context=self.context,
        ).data

    def validate_equipment(self, value):
        if not Equipment.objects.filter(pk=value.pk).exists():
            raise serializers.ValidationError("El equipo no existe.")
        return value

    def validate(self, attrs):
        if self.instance and self.instance.status in (Maintenance.Status.FINISHED, Maintenance.Status.CANCELLED):
            raise serializers.ValidationError("No se puede modificar un mantenimiento cerrado.")
        equipment = attrs.get("equipment", getattr(self.instance, "equipment", None))
        novedad = attrs.get("novedad", getattr(self.instance, "novedad", None))
        if novedad and equipment and novedad.equipment_id != equipment.pk:
            raise serializers.ValidationError({"novedad": "La novedad debe corresponder al mismo equipo."})
        return attrs

    def create(self, validated_data):
        return Maintenance.objects.create(created_by=self.context["request"].user, **validated_data)
