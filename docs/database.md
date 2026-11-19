# Base de datos

## Entidades

- `accounts_role`: rol (código, nombre, si es base) y permisos por módulo en JSON
  (`{"inspections": "manage", "users": "none", ...}`). Los roles base se crean
  en la migración `accounts.0003_seed_base_roles`.
- `accounts_user`: usuario, documento único, nombre, código de rol, estado y si
  debe cambiar la contraseña temporal; un operario puede tener licencias B1,
  C2 y/o C1.
- `catalog_equipmenttype`: tipo de equipo con descripción, activo/inactivo y
  licencia requerida (B1 para camionetas, C2 para volquetas y C1 para cargadores).
- `catalog_equipment`: identificador PK, placa, tipo protegido, estado
  (disponible, en mantenimiento, fuera de servicio), marca/modelo, serie, año y
  horómetro.
- `catalog_itemcategory`: categoría de ítem.
- `catalog_checklistitem`: ítem, categoría, criticidad y estado.
- `catalog_inspectionchecklist`: lista, versión, tipos asociados e ítems.
- `catalog_checklistitemorder`: relación ordenada entre lista e ítem.
- `catalog_checklistversion`: copia fija (JSON) del contenido de cada versión
  de una lista, con quién y cuándo la publicó.
- `inspections_inspection`: equipo, lista, versión aplicada, usuario, fecha y estado.
- `inspections_inspectionresponse`: resultado por ítem y observaciones.
- `new_news`: novedad con equipo, tipo, descripción, usuario, fecha automática y estado.
- `incidents_incidents`: incidente con equipo, descripción, usuario, estado,
  severidad y fecha/hora del evento.
- `inspections_evidence`: evidencia asociada a una inspección, novedad o
  incidente; admite hasta cinco archivos JPG, PNG o PDF de máximo 5 MB cada uno.

Los cambios de entidades auditables generan tablas históricas mediante
`django-simple-history`. Las migraciones se generan con:

```bash
python manage.py makemigrations
python manage.py migrate
```

Las relaciones con entidades históricas o inspecciones usan `PROTECT` cuando
la eliminación rompería trazabilidad. La eliminación de tipos, categorías y
usuarios se realiza de forma lógica desde la API.
