from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from catalog.models import Equipment, EquipmentType
from operational_reports.models import News
from .models import Maintenance, MaintenanceActivity, MaintenanceAssignment, MaintenanceMaterial, MaintenanceStatusHistory


class MaintenanceWorkflowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="workshop-admin", password="Password-12345", document="99990001",
            full_name="Workshop Admin", role=User.Role.ADMINISTRADOR,
        )
        self.client.force_authenticate(self.user)
        kind = EquipmentType.objects.create(name="Camioneta")
        self.equipment = Equipment.objects.create(
            identifier="CAM-HU20", equipment_type=kind, model="Modelo", status=Equipment.Status.USABLE,
        )
        self.maintenance = Maintenance.objects.create(
            equipment=self.equipment, maintenance_type=Maintenance.MaintenanceType.PREVENTIVE,
            scheduled_date=date(2026, 11, 30), priority=Maintenance.Priority.HIGH, created_by=self.user,
        )

    def test_start_requires_responsible_and_records_history_and_equipment_state(self):
        url = f"/api/maintenance/{self.maintenance.pk}/status/"
        denied = self.client.post(url, {"status": Maintenance.Status.IN_PROGRESS}, format="json")
        self.assertEqual(denied.status_code, status.HTTP_400_BAD_REQUEST)
        MaintenanceAssignment.objects.create(maintenance=self.maintenance, user=self.user, assigned_by=self.user)
        started = self.client.post(url, {"status": Maintenance.Status.IN_PROGRESS}, format="json")
        self.assertEqual(started.status_code, status.HTTP_200_OK)
        self.equipment.refresh_from_db()
        self.assertEqual(self.equipment.status, Equipment.Status.MAINTENANCE)
        history = MaintenanceStatusHistory.objects.get(maintenance=self.maintenance)
        self.assertEqual(history.changed_by, self.user)

    def test_generic_update_cannot_set_status_and_cancellation_requires_reason(self):
        direct = self.client.patch(
            f"/api/maintenance/{self.maintenance.pk}/", {"status": Maintenance.Status.FINISHED}, format="json"
        )
        cancel = self.client.post(
            f"/api/maintenance/{self.maintenance.pk}/status/", {"status": Maintenance.Status.CANCELLED}, format="json"
        )
        self.assertEqual(direct.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(cancel.status_code, status.HTTP_400_BAD_REQUEST)

    def test_activities_materials_and_finish_close_related_records(self):
        MaintenanceAssignment.objects.create(maintenance=self.maintenance, user=self.user, assigned_by=self.user)
        self.client.post(
            f"/api/maintenance/{self.maintenance.pk}/status/",
            {"status": Maintenance.Status.IN_PROGRESS}, format="json",
        )
        activity = self.client.post(
            "/api/maintenance/activities/",
            {"maintenance": self.maintenance.pk, "description": "Cambio de filtro", "performed_on": "2026-11-26"},
            format="json",
        )
        material = self.client.post(
            "/api/maintenance/materials/",
            {"maintenance": self.maintenance.pk, "description": "Filtro", "quantity": "1"}, format="json",
        )
        self.assertEqual(activity.status_code, status.HTTP_201_CREATED)
        self.assertEqual(material.status_code, status.HTTP_201_CREATED)
        finish = self.client.post(f"/api/maintenance/{self.maintenance.pk}/finish/", {"final_observations": "Operativo"}, format="json")
        self.assertEqual(finish.status_code, status.HTTP_200_OK)
        self.maintenance.refresh_from_db()
        self.assertEqual(self.maintenance.status, Maintenance.Status.FINISHED)
        self.assertIsNotNone(self.maintenance.finished_at)
        denied = self.client.patch(f"/api/maintenance/activities/{activity.data['id']}/", {"description": "Editado"}, format="json")
        self.assertEqual(denied.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(MaintenanceMaterial.objects.filter(maintenance=self.maintenance).exists())

    def test_finish_requires_activity_and_updates_equipment_and_news(self):
        MaintenanceAssignment.objects.create(maintenance=self.maintenance, user=self.user, assigned_by=self.user)
        self.client.post(f"/api/maintenance/{self.maintenance.pk}/status/", {"status": Maintenance.Status.IN_PROGRESS}, format="json")
        rejected = self.client.post(f"/api/maintenance/{self.maintenance.pk}/finish/", {}, format="json")
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)
        MaintenanceActivity.objects.create(maintenance=self.maintenance, description="Reparación", performed_on=date.today())
        news = News.objects.create(equipment=self.equipment, reported_by=self.user, description="Falla")
        self.maintenance.novedad = news
        self.maintenance.save(update_fields=("novedad",))
        response = self.client.post(f"/api/maintenance/{self.maintenance.pk}/finish/", {"out_of_service": True}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.equipment.refresh_from_db()
        news.refresh_from_db()
        self.assertEqual(self.equipment.status, Equipment.Status.NOT_USABLE)
        self.assertEqual(news.status, News.Status.RESOLVED)

    def test_equipment_history_filters_and_orders_newest_first(self):
        later = Maintenance.objects.create(
            equipment=self.equipment, maintenance_type=Maintenance.MaintenanceType.CORRECTIVE,
            scheduled_date=date(2026, 12, 1), priority=Maintenance.Priority.LOW, created_by=self.user,
        )
        response = self.client.get(f"/api/maintenance/equipment/{self.equipment.pk}/history/?maintenance_type=correctivo")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row["id"] for row in response.data], [later.pk])
