from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers
from inspections.models import Inspection
from maintenance.models import Maintenance
from .models import Evidence, Incident, News

class NewsSerializer(serializers.ModelSerializer):
    performed_by = serializers.PrimaryKeyRelatedField(source="reported_by", read_only=True)
    performed_at = serializers.DateTimeField(source="reported_at", read_only=True)
    tipo = serializers.ChoiceField(source="type", choices=News.Type.choices, required=True)
    estado = serializers.CharField(source="status", read_only=True)
    general_notes = serializers.CharField(source="notes", required=False, allow_blank=True)
    equipment_code = serializers.CharField(source="equipment.identifier", read_only=True)
    equipment_type = serializers.CharField(source="equipment.equipment_type.name", read_only=True)
    reporter_id = serializers.IntegerField(source="reported_by_id", read_only=True)
    reporter_name = serializers.CharField(source="reported_by.full_name", read_only=True)
    description = serializers.CharField(required=True, allow_blank=False)

    class Meta:
        model = News
        fields = ("id", "equipment", "equipment_code", "equipment_type", "performed_by", "reporter_id", "reporter_name", "performed_at", "tipo", "description", "estado", "general_notes")
        read_only_fields = ("id", "performed_by", "performed_at", "estado")

    def create(self, validated_data):
        return News.objects.create(reported_by=self.context["request"].user, **validated_data)


class IncidentSerializer(serializers.ModelSerializer):
    performed_by = serializers.PrimaryKeyRelatedField(source="reported_by", read_only=True)
    performed_at = serializers.DateTimeField(source="reported_at", read_only=True)
    estado = serializers.CharField(source="status", read_only=True)
    severidad = serializers.ChoiceField(source="severity", choices=Incident.Severity.choices, required=True)
    general_notes = serializers.CharField(source="notes", required=False, allow_blank=True)
    equipment_code = serializers.CharField(source="equipment.identifier", read_only=True)
    equipment_type = serializers.CharField(source="equipment.equipment_type.name", read_only=True)
    reporter_id = serializers.IntegerField(source="reported_by_id", read_only=True)
    reporter_name = serializers.CharField(source="reported_by.full_name", read_only=True)
    occurred_at = serializers.DateTimeField(required=True)
    description = serializers.CharField(required=True, allow_blank=False)

    class Meta:
        model = Incident
        fields = ("id", "equipment", "equipment_code", "equipment_type", "performed_by", "reporter_id", "reporter_name", "performed_at", "occurred_at", "description", "estado", "severidad", "general_notes")
        read_only_fields = ("id", "performed_by", "performed_at", "estado")

    def create(self, validated_data):
        return Incident.objects.create(reported_by=self.context["request"].user, **validated_data)


class EvidenceSerializer(serializers.ModelSerializer):
    record_type = serializers.ChoiceField(choices=("inspection", "news", "incident", "maintenance"), write_only=True)
    record_id = serializers.IntegerField(write_only=True)
    url = serializers.FileField(source="file", read_only=True)

    class Meta:
        model = Evidence
        fields = ("id", "record_type", "record_id", "file", "url", "uploaded_by", "uploaded_at")
        read_only_fields = ("id", "uploaded_by", "uploaded_at", "url")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["record_type"] = {
            "inspection": "inspection",
            "news": "news",
            "incident": "incident",
            "maintenance": "maintenance",
        }.get(instance.content_type.model, instance.content_type.model)
        data["record_id"] = instance.object_id
        return data

    def validate(self, attrs):
        file = attrs.get("file")
        if file and file.size > Evidence.MAX_SIZE:
            raise serializers.ValidationError({"file": "El archivo no puede superar 5 MB."})
        if file and file.name.lower().rsplit(".", 1)[-1] not in Evidence.ALLOWED_EXTENSIONS:
            raise serializers.ValidationError({"file": "Solo se permiten archivos JPG, PNG o PDF."})
        model = {"inspection": Inspection, "news": News, "incident": Incident, "maintenance": Maintenance}[attrs["record_type"]]
        try:
            target = model.objects.get(pk=attrs["record_id"])
        except model.DoesNotExist:
            raise serializers.ValidationError({"record_id": "El registro no existe."})
        content_type = ContentType.objects.get_for_model(model)
        if model is Maintenance and target.status in (Maintenance.Status.FINISHED, Maintenance.Status.CANCELLED):
            raise serializers.ValidationError({"record_id": "No se pueden agregar evidencias a un mantenimiento cerrado."})
        if Evidence.objects.filter(content_type=content_type, object_id=target.pk).count() >= 5:
            raise serializers.ValidationError({"file": "Un registro puede tener máximo 5 archivos."})
        attrs["content_type"] = content_type
        attrs["object_id"] = target.pk
        attrs.pop("record_type")
        attrs.pop("record_id")
        return attrs
