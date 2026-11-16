from rest_framework import viewsets

from accounts.permissions import HasSSTPermission
from config.query_filters import filter_operational_records

from .models import News
from .serializers import NewsSerializer


class NewsViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NewsSerializer
    permission_classes = (HasSSTPermission,)
    queryset = News.objects.select_related("equipment__equipment_type", "performed_by").order_by("-performed_at")

    def get_queryset(self):
        return filter_operational_records(
            self.request,
            super().get_queryset(),
            statuses=News.Estados.choices,
            state_field="estado",
        )
