from rest_framework import viewsets

from accounts.permissions import HasSSTPermission
from config.query_filters import filter_operational_records

from .models import Incidents
from .serializers import IncidentSerializer


class IncidentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = IncidentSerializer
    permission_classes = (HasSSTPermission,)
    queryset = Incidents.objects.select_related("equipment__equipment_type", "performed_by").order_by("-performed_at")

    def get_queryset(self):
        return filter_operational_records(
            self.request,
            super().get_queryset(),
            statuses=Incidents.Estados.choices,
            state_field="estado",
            severities=Incidents.Severidad.choices,
            severity_field="severidad",
        )
