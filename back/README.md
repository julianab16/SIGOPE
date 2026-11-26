# SIGOPE Backend

Backend modular de SIGOPE para gestionar usuarios, equipos, tipos de equipo,
listas de inspección e inspecciones. Esta implementación cubre el alcance
concretado en HU-01 a HU-06 del documento recibido y el contrato que usa el
front de administración (`../front`).

## Tecnologías

- Python 3.12+
- Django 5.2 y Django REST Framework
- PostgreSQL
- JWT con SimpleJWT (con lista negra de refresh tokens al cerrar sesión)
- Roles con permisos por módulo
- django-simple-history
- drf-spectacular (OpenAPI/Swagger)
- django-cors-headers (para que el front pueda llamar a la API)

## Puesta en marcha

En Linux o macOS:

```bash
cd back
python -m venv .venv
source .venv/bin/activate o .venv\Scripts\activate.ps1 
pip install -r requirements.txt
cp .env.example .env
# Editar .env con las credenciales reales de PostgreSQL
python manage.py migrate
python manage.py cargar_datos_iniciales   # tipos, equipos y listas del cliente (opcional)
python manage.py createsuperuser
python manage.py runserver
```

`migrate` crea los roles base (Operario, Jefe de Taller, SST, Administrador y
Solo consulta). `createsuperuser` pide usuario, cédula, nombre completo y
contraseña, y deja al superusuario con el rol **Administrador**; con ese
usuario (o su cédula) se entra al front.

`cargar_datos_iniciales` carga los 3 tipos de equipo, 21 equipos y 3 listas de
inspección del Excel "CONTROL PREOPERACIONAL EQUIPOS MÓVILES - TCHO"
(`catalog/fixtures/datos_iniciales.json`). Se puede ejecutar varias veces: no
duplica lo que ya existe.

Variables de `.env`:

| Variable | Uso |
| --- | --- |
| `DJANGO_SECRET_KEY` | Clave secreta. Nunca uses el valor de ejemplo en producción. |
| `DJANGO_DEBUG` | `True` solo en desarrollo. |
| `DJANGO_ALLOWED_HOSTS` | Hosts permitidos, separados por coma. |
| `POSTGRES_*` o `DATABASE_URL` | Conexión a la base de datos. |
| `JWT_ACCESS_MINUTES`, `JWT_REFRESH_DAYS` | Duración de los tokens. |
| `CORS_ALLOWED_ORIGINS` | URLs del front que pueden llamar a la API (por defecto `http://localhost:5173`). |

## Autenticación y permisos

Obtén tokens en `POST /api/auth/login/` con el usuario **o la cédula** y la
contraseña. Usa el token recibido en `Authorization: Bearer <access>`. El
access token expira según `JWT_ACCESS_MINUTES`; se renueva con el refresh en
`POST /api/auth/refresh/` (el front lo hace solo).

Cada rol tiene, por módulo, un nivel: `none` (sin acceso), `view` (solo ver)
o `manage` (ver y gestionar). Leer exige `view` o `manage`; crear, editar o
eliminar exige `manage`. El rol Administrador y los superusuarios siempre
tienen acceso total.

| Módulo (`code`) | Nombre en el front | Endpoints que protege |
| --- | --- | --- |
| `users` | Usuarios y roles | `/api/accounts/users/`, `/api/accounts/roles/` |
| `catalogs` | Catálogos y listas | `/api/catalog/...` (también se pueden **leer** con acceso a `inspections`) |
| `inspections` | Inspecciones | `/api/inspections/records/` |
| `incidents` | Novedades e incidentes | `/api/news/`, `/api/incidents/` y `/api/inspections/evidence/` |
| `maintenance` | Mantenimientos | `/api/maintenance/` |
| `sst`, `documents`, `reports` | Resto de módulos | Reservados para próximas historias |

Las respuestas de error siguen el formato `{"error": {...}}`. Los errores de
un campo vienen con el nombre del campo; los generales, en `detail` o
`non_field_errors`:

```json
{"error": {"document": ["Ya existe un usuario con este documento."]}}
```

## API

Base URL: `http://localhost:8000`. Los endpoints protegidos requieren:

```http
Authorization: Bearer <access>
Content-Type: application/json
```

### Sesión

| Método y ruta | Body | Salida |
| --- | --- | --- |
| `POST /api/auth/login/` | `{"username": "pgomez", "password": "..."}` (`username` acepta la cédula) | `200`, ver abajo |
| `POST /api/auth/refresh/` | `{"refresh": "<refresh>"}` | `200`, `{"access": "<nuevo>"}` |
| `POST /api/accounts/logout/` | `{"refresh": "<refresh>"}` (opcional) | `204`; el refresh queda invalidado |
| `GET /api/accounts/me/` | Ninguno | `200`, datos del usuario autenticado |
| `POST /api/accounts/me/change-password/` | `{"current_password": "...", "new_password": "..."}` | `204` |

Salida del login:

```json
{
    "refresh": "<refresh>",
    "access": "<access>",
    "user": {
        "id": 1,
        "username": "pgomez",
        "full_name": "Patricia Gómez",
        "document": "66851230",
        "role": "administrador",
        "role_name": "Administrador",
        "is_admin": true,
        "must_change_password": false,
        "permissions": {"inspections": "manage", "users": "manage", "...": "..."}
    }
}
```

Las credenciales incorrectas reciben `400` con `Credenciales inválidas.`
(sin decir si falló el usuario o la contraseña). Una cuenta desactivada,
con la contraseña correcta, recibe `400` con `Usuario no activo.`.

Si `must_change_password` es `true` (contraseña temporal), el front pide
cambiarla con `me/change-password/` antes de continuar.

### Usuarios

Ruta base: `/api/accounts/users/`. Módulo `users`.

| Método y ruta | Body | Salida esperada |
| --- | --- | --- |
| `GET /api/accounts/users/` | Ninguno | `200`, lista (filtros `?role=`, `?is_active=`, `?search=`) |
| `GET /api/accounts/users/{id}/` | Ninguno | `200`, usuario |
| `POST /api/accounts/users/` | Ver ejemplo | `201`, usuario creado |
| `PATCH /api/accounts/users/{id}/` | Campos a cambiar | `200`, usuario actualizado |
| `DELETE /api/accounts/users/{id}/` | Ninguno | `204`, usuario desactivado (conserva su historial) |
| `POST /api/accounts/users/{id}/reset-password/` | Ninguno | `200`, `{"temporary_password": "..."}` |

Body para crear (`password` es opcional):

```json
{
    "full_name": "Operario Uno",
    "document": "100000001",
    "role": "operario",
    "licenses": ["B1", "C1"]
}
```

Si no se envía `password`, se genera una contraseña temporal y la respuesta
la incluye una sola vez en `temporary_password`. Todo usuario creado o con
contraseña restablecida por un administrador debe cambiarla al ingresar.

Salida de usuario:

```json
{
    "id": 2,
    "username": "o100000001u",
    "full_name": "Operario Uno",
    "document": "100000001",
    "role": "operario",
    "role_name": "Operario",
    "is_active": true,
    "must_change_password": true
}
```

No se repiten `username` ni `document`, y un usuario no puede desactivarse a
sí mismo.

### Roles

Ruta base: `/api/accounts/roles/`. Módulo `users`.

| Método y ruta | Body | Salida esperada |
| --- | --- | --- |
| `GET /api/accounts/roles/` | Ninguno | `200`, lista |
| `POST /api/accounts/roles/` | `{"name": "Auditor", "read_only": true}` | `201`; con `read_only` empieza en `view` en todos los módulos, si no en `none` |
| `PATCH /api/accounts/roles/{id}/` | `{"name": "..."}` | `200` (los roles base no se renombran) |
| `PUT /api/accounts/roles/{id}/permissions/` | `{"inspections": "view", "catalogs": "manage"}` | `200`; los módulos omitidos quedan en `none` |
| `DELETE /api/accounts/roles/{id}/` | Ninguno | `204` si no es base y no tiene usuarios |

Salida de rol:

```json
{
    "id": 6,
    "code": "auditor",
    "name": "Auditor",
    "is_base": false,
    "permissions": {"inspections": "view", "incidents": "view", "...": "..."},
    "user_count": 0
}
```

Los permisos del Administrador no se pueden modificar.

### Tipos de equipo

Ruta base: `/api/catalog/equipment-types/`. Módulo `catalogs`.

| Método y ruta | Body | Salida esperada |
| --- | --- | --- |
| `GET /api/catalog/equipment-types/` | Ninguno | `200`, lista |
| `GET /api/catalog/equipment-types/{id}/` | Ninguno | `200`, tipo |
| `POST /api/catalog/equipment-types/` | Ver ejemplo | `201`, tipo creado |
| `PATCH /api/catalog/equipment-types/{id}/` | Ver ejemplo | `200`, tipo actualizado |
| `POST /api/catalog/equipment-types/{id}/deactivate/` | Ninguno | `200`, tipo desactivado |
| `DELETE /api/catalog/equipment-types/{id}/` | Ninguno | `204` si no tiene equipos; `400` si tiene equipos |

Body:

```json
{"name": "Compresor", "description": "Compresores Kaishan y Atlas Copco", "is_active": true}
```

La salida incluye además `equipment_count`. El nombre no se repite (sin
distinguir mayúsculas). Al eliminar un tipo, su lista de inspección también
se elimina (o se desactiva si ya tiene inspecciones).

### Equipos

Ruta base: `/api/catalog/equipments/`. Módulo `catalogs`.

| Método y ruta | Body | Salida esperada |
| --- | --- | --- |
| `GET /api/catalog/equipments/` | Ninguno | `200`, lista |
| `GET /api/catalog/equipments/{identifier}/` | Ninguno | `200`, equipo |
| `POST /api/catalog/equipments/` | Ver ejemplo | `201`, equipo creado |
| `PATCH /api/catalog/equipments/{identifier}/` | Ver ejemplo | `200`, equipo actualizado e historial guardado |
| `DELETE /api/catalog/equipments/{identifier}/` | Ninguno | `204`, eliminado (`400` si tiene inspecciones) |

Body para crear o modificar:

```json
{
    "number": 1,
    "plate": "ABC123",
    "equipment_type": 1,
    "status": "usable",
    "model": "Caterpillar 966C",
    "serial_number": "18B01190",
    "year": 1990,
    "hour_meter": "6509"
}
```

`identifier` se genera como las tres primeras letras del tipo y el número
elegido, con tres dígitos: por ejemplo, `COM-001`. El número aceptado va de 1
a 999. `status` puede ser `usable` (Disponible), `en_mantenimiento` (En
mantenimiento) o `no_usable` (Fuera de servicio). El `identifier` se guarda
en mayúsculas, no se repite y no se puede cambiar después de crear el equipo;
la placa tampoco se repite. La salida incluye además `equipment_type_name`,
`status_display`, `last_modified_by` y `last_modified_at` (último cambio,
tomado del historial).

### Categorías e ítems de inspección

Rutas base: `/api/catalog/item-categories/` y `/api/catalog/items/`.
Módulo `catalogs`.

| Recurso | Métodos disponibles | Body de creación |
| --- | --- | --- |
| Categorías | `GET`, `POST`, `GET/{id}`, `PATCH/{id}`, `DELETE/{id}` | `{"name":"Motor", "is_active":true}` |
| Ítems | `GET`, `POST`, `GET/{identifier}`, `PATCH/{identifier}`, `DELETE/{identifier}` | `{"name":"Revisar aceite", "category":1, "is_critical":true, "is_active":true}`; el identifier se genera automáticamente |

Normalmente no hace falta usarlos directamente: al guardar una lista por
secciones, las categorías e ítems se crean solos.

### Listas de inspección

Ruta base: `/api/catalog/checklists/`. Módulo `catalogs`.

| Método y ruta | Body | Salida esperada |
| --- | --- | --- |
| `GET /api/catalog/checklists/` | Ninguno | `200`, lista |
| `GET /api/catalog/checklists/{identifier}/` | Ninguno | `200`, lista |
| `GET /api/catalog/checklists/{identifier}/versions/` | Ninguno | `200`, contenido de cada versión |
| `POST /api/catalog/checklists/` | Ver ejemplo | `201`, lista versión 1 |
| `PATCH /api/catalog/checklists/{identifier}/` | Campos a cambiar | `200`, versión incrementada si cambió el contenido |
| `DELETE /api/catalog/checklists/{identifier}/` | Ninguno | `204` (`400` si tiene inspecciones) |

Body (solo `equipment_types` es obligatorio; `identifier` y `name` se generan
si no se envían):

```json
{
    "equipment_types": [1],
    "sections": [
        {"title": "Motor", "items": [
            {"text": "Nivel de aceite", "is_critical": true},
            {"text": "Fugas"}
        ]},
        {"title": "Luces", "items": [{"text": "Luces delanteras"}]}
    ]
}
```

Cada título de sección es una categoría y cada texto un ítem. También se
puede enviar el contenido como `item_orders` (`[{"item": "ITEM-001",
"position": 1}]`) con ítems ya creados.

Reglas:

- Cada tipo de equipo tiene **una sola** lista.
- Cambiar el nombre o el contenido crea una **versión nueva**. Los ítems no se
  editan en sitio: si cambia el texto se crea un ítem nuevo, así las
  inspecciones anteriores conservan las preguntas que respondieron. El
  contenido de cada versión queda en `versions/`.

### HU-25: consultas SST de inspecciones, novedades e incidentes

Los seis endpoints de consulta requieren autenticación JWT y permiso `view` o
`manage` en el módulo `sst`. El rol base SST ya incluye consulta de inspecciones
y del módulo de novedades/incidentes; los administradores también tienen acceso.
Los endpoints de escritura de inspecciones conservan su permiso habitual.

| Entidad | Listado | Detalle | Filtros disponibles |
| --- | --- | --- | --- |
| Inspecciones | `GET /api/inspections/records/` | `GET /api/inspections/records/{id}/` | `fecha_desde`, `fecha_hasta`, `equipo`, `operario`, `estado`, `severidad=critica` |
| Novedades | `GET /api/news/` | `GET /api/news/{id}/` | `fecha_desde`, `fecha_hasta`, `equipo`, `operario` |
| Incidentes | `GET /api/incidents/` | `GET /api/incidents/{id}/` | `fecha_desde`, `fecha_hasta`, `equipo`, `operario` |

Las fechas son inclusivas y usan `YYYY-MM-DD`; se pueden combinar todos los
filtros de una entidad. `equipo` recibe el identificador del equipo y `operario`
el ID del usuario. Un rango incorrecto, equipo/usuario inexistente, estado
inválido o severidad no disponible responde `400`; detalle inexistente responde
`404`, falta de autenticación `401` y falta de permiso SST `403`.

Ejemplos: `/api/inspections/records/?equipo=CAR-1&fecha_desde=2026-01-01&estado=completed`
y `/api/inspections/records/?severidad=critica`. Las respuestas de inspección
incluyen lista/versión, equipo/tipo, operario, respuestas almacenadas, nombre,
categoría, criticidad y observaciones por ítem, observación general y resultado.
`es_critica` es verdadero cuando el resultado guardado es `critical_failure`,
que el flujo existente asigna ante un ítem crítico respondido `does_not_comply`.

Ejemplo de respuesta de inspección:

```json
{"id": 42, "equipment": "CAR-1", "equipment_type": "Cargador", "performed_by": 7,
 "performed_by_name": "Ana Pérez", "performed_at": "2026-06-18T09:30:00-05:00",
 "status": "completed", "global_result": "critical_failure", "es_critica": true,
 "responses": [{"item": "ITM-01", "item_name": "Frenos", "item_is_critical": true,
 "result": "does_not_comply", "notes": "Fuga detectada"}], "general_notes": "Equipo detenido"}
```

Ejemplo de detalle de novedad o incidente:

```json
{"id": 12, "equipment": "CAR-1", "equipment_code": "CAR-1", "equipment_type": "Cargador",
 "performed_by": 7, "reporter_id": 7, "reporter_name": "Ana Pérez",
 "performed_at": "2026-06-18T09:30:00-05:00", "tipo": "damage", "description": "Descripción registrada", "estado": "reported"}
```

Novedades aceptan los tipos `mechanical_failure`, `unsafe_condition`, `damage` y
`environmental`. Incidentes aceptan severidad `leve`, `media` o `grave` y una
fecha/hora manual `occurred_at`. Ambos recursos tienen estado (`reported`,
`in_review`, `in_progress` cuando aplica, `resolved`/`closed`) y guardan
automáticamente el usuario autenticado y la fecha de registro. Las licencias
del operario se envían como `licenses` (`B1`, `C2`, `C1`) y cada tipo de equipo
puede declarar `required_license`.

### Registros de inspección

Ruta base: `/api/inspections/records/`. Módulo `inspections`.

| Método y ruta | Body | Salida esperada |
| --- | --- | --- |
| `GET /api/inspections/records/` | Ninguno | `200`, inspecciones permitidas para el usuario |
| `GET /api/inspections/records/{id}/` | Ninguno | `200`, inspección |
| `POST /api/inspections/records/` | Ver ejemplo | `201`, inspección creada |
| `PATCH /api/inspections/records/{id}/` | `{"status": "completed"}` | `200`; solo cambia el estado |
| `DELETE /api/inspections/records/{id}/` | Ninguno | `204` |

Body para crear una inspección:

```json
{
    "equipment": "CAR-1",
    "checklist": "CHK-CARGADORES",
    "status": "completed",
    "responses": [
        {"item": "ITM-06EEB96E11", "result": "complies", "notes": "Sin novedades"}
    ]
}
```

Hay que responder todos los ítems de la versión actual de la lista. El
usuario autenticado se guarda como `performed_by` y la versión como
`checklist_version`. Administrador, Jefe de Taller, SST y los roles con
"Solo ver" en Inspecciones ven todas; los demás, solo las suyas.

### Documentación interactiva

- OpenAPI JSON: `GET /api/schema/`
- Swagger UI: `GET /api/docs/`

### Referencia completa de endpoints

Todos los ejemplos siguientes parten de estas variables de shell:

```bash
BASE=http://localhost:8000
TOKEN="<access>"
AUTH="Authorization: Bearer $TOKEN"
```

#### Autenticación y sesión

| Método | Endpoint | Uso |
| --- | --- | --- |
| `POST` | `/api/auth/login/` | Iniciar sesión con `username` o cédula y `password`. |
| `POST` | `/api/auth/refresh/` | Renovar el access token con `refresh`. |
| `POST` | `/api/accounts/logout/` | Invalidar el refresh token; el body es opcional. |
| `GET` | `/api/accounts/me/` | Consultar la sesión y permisos actuales. |
| `POST` | `/api/accounts/me/change-password/` | Cambiar la contraseña actual. |

```bash
curl -X POST "$BASE/api/auth/login/" -H 'Content-Type: application/json' \
    -d '{"username":"100000001","password":"Operario-password-123"}'

curl -X GET "$BASE/api/accounts/me/" -H "$AUTH"

curl -X POST "$BASE/api/accounts/me/change-password/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"current_password":"Temporal-123","new_password":"Nueva-segura-456"}'
```

#### Usuarios y roles

| Método | Endpoint | Body o parámetros |
| --- | --- | --- |
| `GET`, `POST` | `/api/accounts/users/` | Lista o crea usuarios. Filtros: `role`, `is_active`, `search`. |
| `GET`, `PATCH`, `DELETE` | `/api/accounts/users/{id}/` | Consulta, actualiza o desactiva lógicamente un usuario. |
| `POST` | `/api/accounts/users/{id}/reset-password/` | Genera una contraseña temporal. |
| `GET`, `POST` | `/api/accounts/roles/` | Lista o crea roles adicionales. |
| `GET`, `PATCH`, `DELETE` | `/api/accounts/roles/{id}/` | Consulta, actualiza o elimina un rol no base. |
| `PUT` | `/api/accounts/roles/{id}/permissions/` | Reemplaza el mapa de permisos. |

```bash
curl -X POST "$BASE/api/accounts/users/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"full_name":"Operario Uno","document":"100000001","role":"operario","licenses":["B1","C1"]}'

curl -X POST "$BASE/api/accounts/roles/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Auditor","read_only":true}'

curl -X PUT "$BASE/api/accounts/roles/6/permissions/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"inspections":"view","incidents":"view"}'
```

#### Catálogo de equipos y listas

| Método | Endpoint | Body o parámetros |
| --- | --- | --- |
| `GET`, `POST` | `/api/catalog/equipment-types/` | Lista o crea tipos; `required_license` puede ser `B1`, `C2`, `C1` o vacío. |
| `GET`, `PATCH`, `DELETE` | `/api/catalog/equipment-types/{id}/` | Consulta, actualiza o elimina un tipo sin equipos asociados. |
| `POST` | `/api/catalog/equipment-types/{id}/deactivate/` | Desactiva un tipo. |
| `GET`, `POST` | `/api/catalog/equipments/` | Lista o crea equipos. |
| `GET`, `PATCH`, `DELETE` | `/api/catalog/equipments/{identifier}/` | Consulta, actualiza o elimina un equipo según sus relaciones. |
| `GET`, `POST` | `/api/catalog/item-categories/` | Lista o crea categorías. |
| `GET`, `PATCH`, `DELETE` | `/api/catalog/item-categories/{id}/` | Administra categorías. |
| `GET`, `POST` | `/api/catalog/items/` | Lista o crea ítems de checklist. |
| `GET`, `PATCH`, `DELETE` | `/api/catalog/items/{identifier}/` | Administra ítems. |
| `GET`, `POST` | `/api/catalog/checklists/` | Lista o crea listas versionadas. |
| `GET`, `PATCH`, `DELETE` | `/api/catalog/checklists/{identifier}/` | Consulta, actualiza o elimina una lista. |
| `GET` | `/api/catalog/checklists/{identifier}/versions/` | Consulta las versiones publicadas. |

```bash
curl -X POST "$BASE/api/catalog/equipment-types/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Camionetas","description":"Vehículos livianos","required_license":"B1","is_active":true}'

curl -X POST "$BASE/api/catalog/equipments/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"identifier":"CAM-01","plate":"ABC123","equipment_type":1,"status":"usable","model":"Toyota Hilux","serial_number":"SER-01","year":2024,"hour_meter":"120"}'

curl -X POST "$BASE/api/catalog/checklists/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"equipment_types":[1],"sections":[{"title":"Motor","items":[{"text":"Revisar aceite","is_critical":true}]}]}'
```

#### Check-ins e inspecciones

| Método | Endpoint | Body o parámetros |
| --- | --- | --- |
| `GET`, `POST` | `/api/inspections/checkins/` | Consulta o inicia el uso de un equipo. |
| `GET` | `/api/inspections/checkins/{id}/` | Consulta un check-in. |
| `POST` | `/api/inspections/checkins/{id}/close/` | Cierra el check-in del operario autenticado. Body: `{"hour_meter_end": 125.5}`. |
| `GET`, `POST` | `/api/inspections/records/` | Lista o registra inspecciones. |
| `GET`, `PATCH`, `DELETE` | `/api/inspections/records/{id}/` | Consulta, cambia el estado o elimina una inspección según permisos. |

```bash
curl -X POST "$BASE/api/inspections/checkins/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"equipment":"CAM-01","hour_meter_start":120}'

curl -X POST "$BASE/api/inspections/records/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"equipment":"CAM-01","checklist":"CHK-CAMIONETAS","responses":[{"item":"ITEM-01","result":"complies","notes":"Sin novedades"}]}'

curl -X POST "$BASE/api/inspections/checkins/10/close/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"hour_meter_end":125.5}'
```

El operario autenticado se guarda como `performed_by`. Si el tipo de equipo
requiere una licencia, el usuario debe tenerla en `licenses`; de lo contrario
el check-in y la inspección responden `400` con un mensaje explicativo.
La fecha y hora del check-in las asigna el servidor. La lectura final del
horómetro debe ser igual o mayor que la inicial. Las respuestas de inspección
usan `complies`, `does_not_comply` o `not_applicable`; se exige una respuesta
por cada ítem de la lista vigente.

#### Novedades e incidentes

| Método | Endpoint | Body o parámetros |
| --- | --- | --- |
| `GET`, `POST` | `/api/news/` | Lista o registra novedades. |
| `GET`, `PATCH`, `DELETE` | `/api/news/{id}/` | Consulta o administra una novedad según permisos. |
| `GET`, `POST` | `/api/incidents/` | Lista o registra incidentes. |
| `GET`, `PATCH`, `DELETE` | `/api/incidents/{id}/` | Consulta o administra un incidente según permisos. |

```bash
curl -X POST "$BASE/api/news/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"equipment":"CAM-01","tipo":"damage","description":"Golpe en la puerta derecha"}'

curl -X POST "$BASE/api/incidents/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"equipment":"CAM-01","description":"Falla durante la operación","severidad":"grave","occurred_at":"2026-11-16T08:30:00-05:00"}'

curl "$BASE/api/incidents/?estado=reported&severidad=grave" -H "$AUTH"
```

El estado inicial es `reported`. Las novedades usan los tipos
`mechanical_failure`, `unsafe_condition`, `damage` y `environmental`. La fecha
de registro (`performed_at`) y el usuario se asignan automáticamente; la fecha
y hora del evento de un incidente se envían manualmente en `occurred_at`.
Las severidades aceptadas son `leve`, `media` y `grave` (`media` se
presenta como “Moderado” en la interfaz).
El operario que reportó un incidente no puede editarlo después de enviarlo;
los demás cambios siguen sujetos a los permisos del módulo.

#### Evidencias de inspecciones, novedades e incidentes

| Método | Endpoint | Content-Type |
| --- | --- | --- |
| `GET` | `/api/inspections/evidence/` | `application/json` |
| `GET` | `/api/inspections/evidence/{id}/` | `application/json` |
| `POST` | `/api/inspections/evidence/` | `multipart/form-data` para inspecciones |
| `GET`, `POST` | `/api/evidence/` | `application/json` / `multipart/form-data` para novedades e incidentes |

La carga recibe `record_type` (`inspection`, `news` o `incident`), `record_id`
y `file`. Usa `/api/inspections/evidence/` para inspecciones y `/api/evidence/`
para novedades e incidentes. Se aceptan JPG, JPEG, PNG y PDF; cada archivo
debe pesar como máximo 5 MB y cada registro puede tener hasta cinco archivos.
El usuario autenticado queda como `uploaded_by` y la respuesta incluye la URL
`url` para visualizarlo.
Los errores de formato, tamaño, registro inexistente o límite de archivos
responden `400` con el campo que debe corregirse.

```bash
curl -X POST "$BASE/api/inspections/evidence/" -H "$AUTH" \
    -F 'record_type=inspection' -F 'record_id=42' \
    -F 'file=@./evidencia.jpg'

curl "$BASE/api/inspections/evidence/15/" -H "$AUTH"
```

#### Mantenimientos

| Método | Endpoint | Body o parámetros |
| --- | --- | --- |
| `GET`, `POST` | `/api/maintenance/` | Lista o programa mantenimientos. Filtros: `equipment`, `maintenance_type`, `priority`, `scheduled_date`, `status`. |
| `GET`, `PATCH`, `DELETE` | `/api/maintenance/{id}/` | Consulta, edita o elimina un mantenimiento. |
| `PUT` | `/api/maintenance/{id}/assign/` | Asigna responsables con `{"responsible_ids":[2,3]}`. |
| `POST` | `/api/maintenance/{id}/reschedule/` | Reprograma con `scheduled_date` y `reason`. |
| `POST` | `/api/maintenance/{id}/status/` | Cambia a `en_ejecucion` o `cancelado`; cancelación requiere `reason`. El estado `finalizado` solo se establece mediante `/finish/`. |
| `POST` | `/api/maintenance/{id}/finish/` | Finaliza con `final_observations` opcional y `out_of_service` opcional (booleano). Requiere una actividad. |
| `GET` | `/api/maintenance/equipment/{equipment_id}/history/` | Historial cronológico descendente. Filtros opcionales: `date_from`, `date_to`, `maintenance_type`. |
| `GET`, `POST` | `/api/maintenance/activities/` | Consulta o registra actividades; al crear requiere `maintenance`, `description` y `performed_on`. |
| `GET`, `PATCH`, `DELETE` | `/api/maintenance/activities/{id}/` | Consulta o modifica/elimina actividad mientras el mantenimiento esté abierto. |
| `GET`, `POST` | `/api/maintenance/materials/` | Consulta o registra materiales; al crear requiere `maintenance`, `description` y `quantity` positiva. |
| `GET`, `PATCH`, `DELETE` | `/api/maintenance/materials/{id}/` | Consulta o modifica/elimina material mientras el mantenimiento esté abierto. |
| `POST` | `/api/evidence/` | Evidencias reutilizan el módulo compartido; usar `record_type: "maintenance"` y `record_id` del mantenimiento. Se conservan límites existentes (JPG/JPEG/PNG/PDF, 5 MB, máximo 5 archivos). |

```bash
curl -X POST "$BASE/api/maintenance/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"equipment":"CAM-01","maintenance_type":"preventivo","scheduled_date":"2026-12-01","priority":"media"}'

curl -X PUT "$BASE/api/maintenance/4/assign/" -H "$AUTH" \
    -H 'Content-Type: application/json' -d '{"responsible_ids":[2,3]}'

curl -X POST "$BASE/api/maintenance/4/reschedule/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"scheduled_date":"2026-12-05","reason":"Disponibilidad de repuestos"}'

curl -X POST "$BASE/api/maintenance/4/status/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"status":"en_ejecucion"}'

curl -X POST "$BASE/api/maintenance/4/finish/" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"final_observations":"Prueba satisfactoria","out_of_service":false}'

curl "$BASE/api/maintenance/equipment/CAM-01/history/?date_from=2026-01-01&maintenance_type=preventivo" -H "$AUTH"
```

#### Esquema y administración

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/schema/` | Descargar el esquema OpenAPI. |
| `GET` | `/api/docs/` | Abrir Swagger UI. |
| `GET` | `/admin/` | Consola administrativa de Django. |

Los archivos cargados se sirven desde `/media/` únicamente cuando
`DJANGO_DEBUG=True`. En producción se recomienda configurar el servidor web o
el almacenamiento de objetos para servir `MEDIA_ROOT` de forma segura.

Las modificaciones de equipos conservan usuario y fecha mediante el historial
de `django-simple-history`.

## Estructura

```text
config/        configuración, URLs y excepciones
accounts/      usuarios, roles y permisos, autenticación y contraseñas
catalog/       tipos, equipos, categorías, ítems y listas versionadas
               (management/commands/cargar_datos_iniciales.py y fixtures/)
inspections/   registros y respuestas de inspección
operational_reports/
               novedades, incidentes y evidencias
common/        filtros y utilidades compartidas entre dominios
```

Las apps `new` e `incidents` se conservan temporalmente como fuente de datos
para la migración hacia `operational_reports`; sus rutas públicas ya utilizan
la nueva app. `maintenance`, `sst`, `documents`, `notifications` y `reports`
siguen siendo dominios separados para futuras historias.
