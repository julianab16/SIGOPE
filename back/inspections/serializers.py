from django.db import transaction
from rest_framework import serializers

from django.utils import timezone
from django.contrib.contenttypes.models import ContentType

from catalog.models import Equipment, InspectionChecklist
from .models import EquipmentCheckIn, Evidence, Inspection, InspectionResponse


def validate_license_for_equipment(user, equipment):
    required = equipment.equipment_type.required_license
    if required and required not in (user.licenses or []):
        raise serializers.ValidationError({"equipment": f"El operario necesita licencia {required} para este equipo."})


class CheckInSerializer(serializers.ModelSerializer):
    equipment = serializers.PrimaryKeyRelatedField(queryset=Equipment.objects.all())
    operator = serializers.PrimaryKeyRelatedField(read_only=True)
    equipment_code = serializers.CharField(source="equipment.identifier", read_only=True)
    checklist_id = serializers.SerializerMethodField()

    class Meta:
        model = EquipmentCheckIn
        fields = ("id", "equipment", "equipment_code", "operator", "hour_meter_start", "hour_meter_end", "checked_in_at", "closed_at", "checklist_id")
        read_only_fields = ("id", "hour_meter_end", "checked_in_at", "closed_at")

    def get_checklist_id(self, obj):
        checklist = InspectionChecklist.objects.filter(equipment_types=obj.equipment.equipment_type, is_active=True).first()
        return checklist.pk if checklist else None

    def validate_hour_meter_start(self, value):
        if value < 0:
            raise serializers.ValidationError("La lectura debe ser numérica y no negativa.")
        return value

    def validate(self, attrs):
        equipment = attrs["equipment"]
        if equipment.status != Equipment.Status.USABLE:
            raise serializers.ValidationError({"equipment": "El equipo no está disponible."})
        validate_license_for_equipment(self.context["request"].user, equipment)
        if EquipmentCheckIn.objects.filter(equipment=equipment, closed_at__isnull=True).exists():
            raise serializers.ValidationError({"equipment": "El equipo ya tiene un check-in abierto."})
        return attrs

    def create(self, validated_data):
        validated_data["operator"] = self.context["request"].user
        return EquipmentCheckIn.objects.create(**validated_data)


class CheckInCloseSerializer(serializers.Serializer):
    hour_meter_end = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)

    def validate(self, attrs):
        checkin = self.context["checkin"]
        if attrs["hour_meter_end"] < checkin.hour_meter_start:
            raise serializers.ValidationError(
                {"hour_meter_end": "La lectura final debe ser igual o mayor a la inicial."}
            )
        return attrs


class InspectionResponseSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_is_critical = serializers.BooleanField(source="item.is_critical", read_only=True)
    category_name = serializers.CharField(source="item.category.name", read_only=True)

    class Meta:
        model = InspectionResponse
        fields = ("item", "item_name", "category_name", "item_is_critical", "result", "notes")


class InspectionSerializer(serializers.ModelSerializer):
    responses = InspectionResponseSerializer(many=True)
    performed_by = serializers.PrimaryKeyRelatedField(read_only=True)
    performed_by_name = serializers.CharField(source="performed_by.full_name", read_only=True)
    checklist_version = serializers.IntegerField(read_only=True)
    global_result = serializers.CharField(read_only=True)
    equipment_code = serializers.CharField(source="equipment.identifier", read_only=True)
    equipment_type = serializers.CharField(source="equipment.equipment_type.name", read_only=True)
    checklist_name = serializers.CharField(source="checklist.name", read_only=True)
    es_critica = serializers.SerializerMethodField()

    class Meta:
        model = Inspection
        fields = (
            "id",
            "equipment",
            "equipment_code",
            "equipment_type",
            "checklist",
            "checklist_name",
            "checklist_version",
            "performed_by",
            "performed_by_name",
            "performed_at",
            "status",
            "responses",
            "checkin",
            "general_notes",
            "global_result",
            "es_critica",
        )
        read_only_fields = ("id", "performed_at")

    def get_es_critica(self, obj):
        return obj.global_result == Inspection.GlobalResult.CRITICAL_FAILURE

    def validate(self, attrs):
        if self.instance:
            # Una inspección registrada solo cambia de estado; equipo, lista y respuestas son fijos.
            fixed = {"equipment", "checklist", "responses"} & set(attrs)
            if fixed:
                raise serializers.ValidationError(
                    {field: "No se puede modificar en una inspección registrada." for field in fixed}
                )
            return attrs

        checkin = attrs.get("checkin")
        equipment = checkin.equipment if checkin else attrs["equipment"]
        checklist = attrs["checklist"]
        if checkin:
            request = self.context["request"]
            if checkin.equipment_id != equipment.pk or checkin.operator_id != request.user.pk:
                raise serializers.ValidationError({"checkin": "El check-in no corresponde al operario y equipo."})
            if hasattr(checkin, "inspection"):
                raise serializers.ValidationError({"checkin": "Este check-in ya tiene inspección."})
        if not checklist.is_active:
            raise serializers.ValidationError({"checklist": "La lista de inspección está inactiva."})
        if not checklist.equipment_types.filter(pk=equipment.equipment_type_id).exists():
            raise serializers.ValidationError(
                {"checklist": "La lista no está asociada al tipo de equipo seleccionado."}
            )
        validate_license_for_equipment(self.context["request"].user, equipment)
        response_items = [response["item"].pk for response in attrs.get("responses", [])]
        checklist_items = set(checklist.items.values_list("pk", flat=True))
        if len(response_items) != len(set(response_items)) or set(response_items) != checklist_items:
            raise serializers.ValidationError(
                {"responses": "Debe responder todos los ítems de la versión de la lista."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        responses = validated_data.pop("responses")
        checklist = validated_data["checklist"]
        checkin = validated_data.get("checkin")
        critical_items = set(checklist.items.filter(is_critical=True).values_list("pk", flat=True))
        critical_failure = any(r["item"].pk in critical_items and r["result"] == InspectionResponse.Result.DOES_NOT_COMPLY for r in responses)
        validated_data["status"] = Inspection.Status.COMPLETED
        validated_data["global_result"] = Inspection.GlobalResult.CRITICAL_FAILURE if critical_failure else Inspection.GlobalResult.COMPLETED
        if checkin:
            validated_data["equipment"] = checkin.equipment
        inspection = Inspection.objects.create(
            performed_by=self.context["request"].user,
            checklist_version=checklist.version,
            **validated_data,
        )
        InspectionResponse.objects.bulk_create(
            [InspectionResponse(inspection=inspection, **response) for response in responses]
        )
        return inspection

    def update(self, instance, validated_data):
        if instance.status == Inspection.Status.COMPLETED:
            raise serializers.ValidationError("No se puede modificar una inspección finalizada.")
        instance.status = validated_data.get("status", instance.status)
        instance.save(update_fields=["status"])
        return instance


class EvidenceSerializer(serializers.ModelSerializer):
    record_type = serializers.ChoiceField(
        choices=("inspection", "news", "incident"), write_only=True
    )
    record_id = serializers.IntegerField(write_only=True)
    url = serializers.FileField(source="file", read_only=True)

    class Meta:
        model = Evidence
        fields = ("id", "record_type", "record_id", "file", "url", "uploaded_by", "uploaded_at")
        read_only_fields = ("id", "uploaded_by", "uploaded_at", "url")

    def validate(self, attrs):
        file = attrs.get("file")
        if file and file.size > Evidence.MAX_SIZE:
            raise serializers.ValidationError({"file": "El archivo no puede superar 5 MB."})
        if file and file.name.lower().rsplit(".", 1)[-1] not in Evidence.ALLOWED_EXTENSIONS:
            raise serializers.ValidationError({"file": "Solo se permiten archivos JPG, PNG o PDF."})
        model_name = attrs["record_type"]
        model = {"inspection": Inspection, "news": "new.News", "incident": "incidents.Incidents"}[model_name]
        if isinstance(model, str):
            from django.apps import apps
            model = apps.get_model(model)
        try:
            target = model.objects.get(pk=attrs["record_id"])
        except model.DoesNotExist:
            raise serializers.ValidationError({"record_id": "El registro no existe."})
        content_type = ContentType.objects.get_for_model(model)
        if Evidence.objects.filter(content_type=content_type, object_id=target.pk).count() >= 5:
            raise serializers.ValidationError({"file": "Un registro puede tener máximo 5 archivos."})
        attrs["content_type"] = content_type
        attrs["object_id"] = target.pk
        attrs.pop("record_type")
        attrs.pop("record_id")
        return attrs
