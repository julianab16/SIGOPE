from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError

from accounts.models import User
from catalog.models import Equipment


def filter_operational_records(
    request,
    queryset,
    date_field="performed_at",
    *,
    operator_field="performed_by_id",
    statuses=None,
    state_field="status",
    severities=None,
    severity_field="severidad",
    critical_filter=False,
):
    params = request.query_params
    start = params.get("fecha_desde")
    end = params.get("fecha_hasta")
    start_date = parse_date(start) if start else None
    end_date = parse_date(end) if end else None
    if (start and not start_date) or (end and not end_date):
        raise ValidationError({"fecha": "Use el formato YYYY-MM-DD para fecha_desde y fecha_hasta."})
    if start_date and end_date and start_date > end_date:
        raise ValidationError({"fecha": "fecha_desde no puede ser posterior a fecha_hasta."})
    if start_date:
        queryset = queryset.filter(**{f"{date_field}__date__gte": start_date})
    if end_date:
        queryset = queryset.filter(**{f"{date_field}__date__lte": end_date})

    equipment = params.get("equipo")
    if equipment:
        if not Equipment.objects.filter(pk=equipment).exists():
            raise ValidationError({"equipo": "El equipo indicado no existe."})
        queryset = queryset.filter(equipment_id=equipment)
    operator = params.get("operario")
    if operator:
        if not operator.isdigit() or not User.objects.filter(pk=operator).exists():
            raise ValidationError({"operario": "El usuario indicado no existe."})
        queryset = queryset.filter(**{operator_field: operator})

    state = params.get("estado")
    if state:
        if statuses is None:
            raise ValidationError({"estado": "Esta entidad no tiene estados definidos."})
        valid_states = [value for value, _ in statuses]
        if state not in valid_states:
            raise ValidationError({"estado": f"Valor invalido. Opciones: {', '.join(valid_states)}."})
        queryset = queryset.filter(**{state_field: state})

    severity = params.get("severidad")
    if severity:
        if severities is not None:
            valid_severities = [value for value, _ in severities]
            if severity not in valid_severities:
                raise ValidationError({"severidad": f"Valor invalido. Opciones: {', '.join(valid_severities)}."})
            queryset = queryset.filter(**{severity_field: severity})
        elif critical_filter:
            if severity != "critica":
                raise ValidationError({"severidad": "El unico nivel derivable en inspecciones es critica."})
            queryset = queryset.filter(global_result="critical_failure")
        else:
            raise ValidationError({"severidad": "Esta entidad no tiene severidad definida."})
    return queryset
