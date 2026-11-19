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
  API --> Reports[operational_reports: novedades, incidentes y evidencias]
  Auth --> DB[(PostgreSQL)]
  Catalog --> DB
  Inspections --> DB
  Reports --> DB
```

Las vistas reciben la petición, los serializadores validan el contrato y los
modelos mantienen integridad referencial. `simple-history` registra cambios
en usuarios, tipos, equipos, categorías, ítems y listas. HU-25 reutiliza el
viewset existente de inspecciones e incorpora consultas y registro de
novedades, incidentes y evidencias en `operational_reports`. La lectura de
inspecciones admite los módulos `inspections` y `sst`; la escritura se mantiene
protegida por `inspections`.
