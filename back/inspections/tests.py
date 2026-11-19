from decimal import Decimal
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Module, Role, User, permissions_with
from catalog.models import (
    ChecklistItem,
    ChecklistItemOrder,
    Equipment,
    EquipmentType,
    InspectionChecklist,
    ItemCategory,
)
from .models import EquipmentCheckIn, Evidence, Inspection, InspectionResponse


class InspectionApiTests(APITestCase):
    def setUp(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        media_override = override_settings(MEDIA_ROOT=media_directory.name)
        media_override.enable()
        self.addCleanup(media_override.disable)
        self.operator = User.objects.create_user(
            username="operator",
            password="Operator-password-123",
            document="30000001",
            full_name="Operator User",
            role=User.Role.OPERARIO,
        )
        self.client.force_authenticate(self.operator)
        self.equipment_type = EquipmentType.objects.create(name="Forklift")
        self.equipment = Equipment.objects.create(
            identifier="FORK-001",
            equipment_type=self.equipment_type,
            model="Forklift Model",
        )
        self.category = ItemCategory.objects.create(name="Safety")
        self.item = ChecklistItem.objects.create(
            identifier="ITEM-01",
            name="Check seat belt",
            category=self.category,
        )
        self.checklist = InspectionChecklist.objects.create(
            identifier="CHK-FORKLIFT",
            name="Forklift checklist",
        )
        self.checklist.equipment_types.add(self.equipment_type)
        ChecklistItemOrder.objects.create(
            checklist=self.checklist, item=self.item, position=1
        )

    def inspection_payload(self, result="complies", **extra):
        payload = {
            "equipment": self.equipment.identifier,
            "checklist": self.checklist.identifier,
            "responses": [{"item": self.item.identifier, "result": result}],
        }
        payload.update(extra)
        return payload

    def create_inspection(self, result="complies", **extra):
        return self.client.post(
            "/api/inspections/records/",
            self.inspection_payload(result=result, **extra),
            format="json",
        )

    def test_operator_can_create_inspection_with_all_checklist_responses(self):
        response = self.create_inspection()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["performed_by"], self.operator.pk)
        self.assertEqual(response.data["checklist_version"], self.checklist.version)
        self.assertEqual(len(response.data["responses"]), 1)
        self.assertEqual(response.data["status"], Inspection.Status.COMPLETED)

    def test_inspection_requires_response_for_every_checklist_item(self):
        response = self.client.post(
            "/api/inspections/records/",
            {
                "equipment": self.equipment.identifier,
                "checklist": self.checklist.identifier,
                "responses": [],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_completed_inspection_cannot_change_status_or_answers(self):
        created = self.create_inspection()
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        inspection_id = created.data["id"]

        status_update = self.client.patch(
            f"/api/inspections/records/{inspection_id}/",
            {"status": "in_progress"},
            format="json",
        )
        answers_update = self.client.patch(
            f"/api/inspections/records/{inspection_id}/",
            {"responses": [{"item": self.item.identifier, "result": "does_not_comply"}]},
            format="json",
        )

        self.assertEqual(status_update.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(answers_update.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Inspection.objects.get(pk=inspection_id).status, Inspection.Status.COMPLETED)
        self.assertEqual(InspectionResponse.objects.get(inspection_id=inspection_id).result, "complies")

    def test_inspection_rejects_checklist_for_a_different_equipment_type(self):
        other_type = EquipmentType.objects.create(name="Roller")
        other_equipment = Equipment.objects.create(
            identifier="ROLL-001", equipment_type=other_type, model="Roller Model"
        )

        response = self.client.post(
            "/api/inspections/records/",
            {
                "equipment": other_equipment.identifier,
                "checklist": self.checklist.identifier,
                "responses": [{"item": self.item.identifier, "result": "complies"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_operator_can_only_list_own_inspections(self):
        other_operator = User.objects.create_user(
            username="other", password="Other-password-123", document="30000002",
            full_name="Other Operator", role=User.Role.OPERARIO,
        )
        inspection = Inspection.objects.create(
            equipment=self.equipment, checklist=self.checklist,
            checklist_version=self.checklist.version, performed_by=other_operator,
        )
        InspectionResponse.objects.create(
            inspection=inspection, item=self.item, result="complies",
        )

        response = self.client.get("/api/inspections/records/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    def test_inspection_accepts_each_supported_response_result(self):
        for result in ("complies", "does_not_comply", "not_applicable"):
            with self.subTest(result=result):
                response = self.create_inspection(result=result)
                self.assertEqual(response.status_code, status.HTTP_201_CREATED)
                self.assertEqual(response.data["responses"][0]["result"], result)

    def test_inspection_rejects_duplicate_response_for_same_item(self):
        response = self.client.post(
            "/api/inspections/records/",
            {
                "equipment": self.equipment.identifier,
                "checklist": self.checklist.identifier,
                "responses": [
                    {"item": self.item.identifier, "result": "complies"},
                    {"item": self.item.identifier, "result": "does_not_comply"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Inspection.objects.count(), 0)

    def test_inspection_rejects_inactive_checklist(self):
        self.checklist.is_active = False
        self.checklist.save(update_fields=["is_active"])

        response = self.create_inspection()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Inspection.objects.count(), 0)

    def test_critical_noncompliance_sets_global_critical_failure(self):
        self.item.is_critical = True
        self.item.save(update_fields=["is_critical"])

        response = self.create_inspection(result="does_not_comply")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["global_result"], Inspection.GlobalResult.CRITICAL_FAILURE)
        self.assertTrue(response.data["es_critica"])

    def test_noncritical_or_compliant_answers_set_global_completed(self):
        response = self.create_inspection(result="does_not_comply")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["global_result"], Inspection.GlobalResult.COMPLETED)
        self.assertFalse(response.data["es_critica"])

    def test_user_with_inspection_view_permission_can_list_other_operators_inspections(self):
        viewer_role = Role.objects.create(
            code="inspection_auditor", name="Inspection Auditor",
            permissions=permissions_with(view=(Module.INSPECTIONS,)),
        )
        other_operator = User.objects.create_user(
            username="another-operator", password="Other-password-123",
            document="30000003", full_name="Another Operator", role=User.Role.OPERARIO,
        )
        other_inspection = Inspection.objects.create(
            equipment=self.equipment, checklist=self.checklist,
            checklist_version=self.checklist.version, performed_by=other_operator,
        )
        InspectionResponse.objects.create(
            inspection=other_inspection, item=self.item, result="complies"
        )
        viewer = User.objects.create_user(
            username="inspection-auditor", password="Auditor-password-123",
            document="30000004", full_name="Inspection Auditor", role=viewer_role.code,
        )
        self.client.force_authenticate(viewer)

        response = self.client.get("/api/inspections/records/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], other_inspection.pk)

    def test_inspection_requires_driving_license_even_without_checkin(self):
        self.equipment_type.required_license = "B1"
        self.equipment_type.save(update_fields=["required_license"])

        denied = self.create_inspection()
        self.operator.licenses = ["B1"]
        self.operator.save(update_fields=["licenses"])
        allowed = self.create_inspection()

        self.assertEqual(denied.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(allowed.status_code, status.HTTP_201_CREATED)

    def test_checkin_can_be_created_and_is_assigned_to_authenticated_operator(self):
        response = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "125.50"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        checkin = EquipmentCheckIn.objects.get(pk=response.data["id"])
        self.assertEqual(checkin.operator, self.operator)
        self.assertEqual(checkin.hour_meter_start, Decimal("125.50"))
        self.assertIsNone(checkin.closed_at)

    def test_equipment_cannot_have_two_open_checkins(self):
        EquipmentCheckIn.objects.create(
            equipment=self.equipment, operator=self.operator, hour_meter_start=Decimal("10")
        )

        response = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "11"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(EquipmentCheckIn.objects.filter(equipment=self.equipment, closed_at__isnull=True).count(), 1)

    def test_checkin_rejects_unavailable_equipment_and_negative_hour_meter(self):
        self.equipment.status = Equipment.Status.MAINTENANCE
        self.equipment.save(update_fields=["status"])
        unavailable = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "10"},
            format="json",
        )
        self.equipment.status = Equipment.Status.USABLE
        self.equipment.save(update_fields=["status"])
        negative_meter = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "-1"},
            format="json",
        )

        self.assertEqual(unavailable.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(negative_meter.status_code, status.HTTP_400_BAD_REQUEST)

    def test_checkin_requires_equipment_type_driving_license(self):
        self.equipment_type.required_license = "C2"
        self.equipment_type.save(update_fields=["required_license"])
        denied = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "10"},
            format="json",
        )
        self.operator.licenses = ["C2"]
        self.operator.save(update_fields=["licenses"])
        allowed = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "10"},
            format="json",
        )

        self.assertEqual(denied.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(allowed.status_code, status.HTTP_201_CREATED)

    def test_checkin_close_rejects_lower_hour_meter_and_accepts_valid_reading(self):
        created = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "100"},
            format="json",
        )
        checkin_id = created.data["id"]
        invalid_close = self.client.post(
            f"/api/inspections/checkins/{checkin_id}/close/",
            {"hour_meter_end": "99"}, format="json",
        )
        valid_close = self.client.post(
            f"/api/inspections/checkins/{checkin_id}/close/",
            {"hour_meter_end": "125.25"}, format="json",
        )

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(invalid_close.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(valid_close.status_code, status.HTTP_200_OK)
        checkin = EquipmentCheckIn.objects.get(pk=checkin_id)
        self.assertEqual(checkin.hour_meter_end, Decimal("125.25"))
        self.assertIsNotNone(checkin.closed_at)

    def test_only_operator_who_started_checkin_can_close_it(self):
        created = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "20"},
            format="json",
        )
        admin = User.objects.create_user(
            username="admin", password="Admin-password-123", document="30000005",
            full_name="Admin User", role=User.Role.ADMINISTRADOR,
        )
        self.client.force_authenticate(admin)

        response = self.client.post(
            f"/api/inspections/checkins/{created.data['id']}/close/",
            {"hour_meter_end": "25"}, format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIsNone(EquipmentCheckIn.objects.get(pk=created.data["id"]).closed_at)

    def test_closed_checkin_cannot_be_closed_again(self):
        created = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "30"},
            format="json",
        )
        checkin_id = created.data["id"]
        first_close = self.client.post(
            f"/api/inspections/checkins/{checkin_id}/close/",
            {"hour_meter_end": "35"}, format="json",
        )
        second_close = self.client.post(
            f"/api/inspections/checkins/{checkin_id}/close/",
            {"hour_meter_end": "36"}, format="json",
        )

        self.assertEqual(first_close.status_code, status.HTTP_200_OK)
        self.assertEqual(second_close.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inspection_can_be_linked_to_operator_checkin(self):
        checkin_response = self.client.post(
            "/api/inspections/checkins/",
            {"equipment": self.equipment.identifier, "hour_meter_start": "50"},
            format="json",
        )
        inspection_response = self.client.post(
            "/api/inspections/records/",
            {
                "equipment": self.equipment.identifier,
                "checklist": self.checklist.identifier,
                "checkin": checkin_response.data["id"],
                "responses": [{"item": self.item.identifier, "result": "complies"}],
            },
            format="json",
        )

        self.assertEqual(checkin_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(inspection_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(inspection_response.data["checkin"], checkin_response.data["id"])

    def test_evidence_accepts_allowed_file_for_inspection(self):
        inspection = self.create_inspection()
        upload = SimpleUploadedFile("photo.jpg", b"image-content", content_type="image/jpeg")

        response = self.client.post(
            "/api/inspections/evidence/",
            {"record_type": "inspection", "record_id": inspection.data["id"], "file": upload},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Evidence.objects.count(), 1)
        self.assertEqual(Evidence.objects.get().uploaded_by, self.operator)

    def test_evidence_rejects_disallowed_extension_and_files_over_five_mb(self):
        inspection = self.create_inspection()
        invalid_extension = SimpleUploadedFile("notes.txt", b"not allowed", content_type="text/plain")
        invalid_response = self.client.post(
            "/api/inspections/evidence/",
            {"record_type": "inspection", "record_id": inspection.data["id"], "file": invalid_extension},
            format="multipart",
        )
        oversized = SimpleUploadedFile("large.pdf", b"0" * (5 * 1024 * 1024 + 1), content_type="application/pdf")
        oversized_response = self.client.post(
            "/api/inspections/evidence/",
            {"record_type": "inspection", "record_id": inspection.data["id"], "file": oversized},
            format="multipart",
        )

        self.assertEqual(invalid_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(oversized_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Evidence.objects.count(), 0)

    def test_evidence_limit_is_five_files_per_record(self):
        inspection = self.create_inspection()
        self.assertEqual(inspection.status_code, status.HTTP_201_CREATED)
        for index in range(5):
            upload = SimpleUploadedFile(f"photo-{index}.png", b"image", content_type="image/png")
            response = self.client.post(
                "/api/inspections/evidence/",
                {"record_type": "inspection", "record_id": inspection.data["id"], "file": upload},
                format="multipart",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        sixth_upload = SimpleUploadedFile("photo-6.png", b"image", content_type="image/png")
        sixth_response = self.client.post(
            "/api/inspections/evidence/",
            {"record_type": "inspection", "record_id": inspection.data["id"], "file": sixth_upload},
            format="multipart",
        )

        self.assertEqual(sixth_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Evidence.objects.count(), 5)
