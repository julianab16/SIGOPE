# Arquitectura

SIGOPE usa un monolito modular Django. Cada app representa un dominio y
expone modelos, serializadores y viewsets REST. La configuración transversal
vive en `config/`.

```mermaid
flowchart LR
  Client[Cliente React/PWA] --> API[Django REST API]
  API --> Auth[accounts: JWT y roles]
  API --> Catalog[catalog: catálogo y checklists]
  API --> Inspections[inspections: respuestas]
  API --> News[new: consultas de novedades]
  API --> Incidents[incidents: consultas de incidentes]
  Auth --> DB[(PostgreSQL)]
  Catalog --> DB
  Inspections --> DB
  News --> DB
  Incidents --> DB
```

Las vistas reciben la petición, los serializadores validan el contrato y los
modelos mantienen integridad referencial. `simple-history` registra cambios
en usuarios, tipos, equipos, categorías, ítems y listas. HU-25 reutiliza el
viewset existente de inspecciones e incorpora consultas de solo lectura para
novedades e incidentes, protegidas por el permiso del módulo `sst`.
