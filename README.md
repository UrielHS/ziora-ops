# Ziora Ops

Herramienta interna para operar Ziora: tareas tipo Jira, pipeline de demos, QA y bugs, PRs de GitHub,
correo masivo con plantillas HTML, CRM de leads (embudo, dueño, siguiente paso, timeline) y contactos de psicólogos
(propios de Ziora Ops, importables desde Event Ops).

## Cómo se conecta con Event Ops

Comparte la misma instancia y base de Cloud SQL (`event-ops-509602 / event-ops-db / eventops`):

- `public.*` es de Event Ops. Ziora Ops lee usuarios y eventos, y crea o completa contactos y etiquetas.
  Nunca borra ni migra esas tablas. El espejo está en `src/db/shared.ts`.
- `ops.*` es de Ziora Ops. drizzle-kit solo ve `src/db/schema.ts` y solo migra ese schema.
- El login es el mismo Google OAuth y la misma tabla `users`: quien está activo en uno, entra al otro.

Puesta en marcha completa: **`docs/SETUP-CONEXION.md`**. El cambio que necesita Event Ops: `docs/event-ops-patch/`.

## Stack

El mismo que Event Ops: Node 22 · Next.js 15 · Drizzle + Postgres 16 · Auth.js v5 · Tailwind 4 · zod · Vitest.
Integraciones: Resend (correo) y Octokit (GitHub).

## Endpoints

| Ruta | Para qué | Autenticación |
|---|---|---|
| `POST /api/webhooks/demo` | Solicitudes de ziora-copilot.com/demo → demo, contacto y avance del lead | HMAC `X-Ziora-Signature` |
| `POST /api/webhooks/github` | PRs y reviews en tiempo real | HMAC de GitHub |
| `POST /api/webhooks/resend` | Entregas, aperturas, rebotes y quejas | Firma Svix |
| `GET/POST /api/unsubscribe?t=` | Baja de correos (un clic, RFC 8058) | Token HMAC |
| `POST /api/bugs` | Reportes desde la app de Ziora o Sentry | Bearer `BUG_INTAKE_KEY` |
| `POST /api/jobs/sync-github` | Resincronización de PRs (Cloud Scheduler) | Bearer `JOB_SECRET` |
| `POST /api/jobs/sync-demos` | Lee demos del Google Calendar del CEO (cada 10 min) | Bearer `JOB_SECRET` |
| `POST /api/jobs/send-campaign` | Envía una campaña | Bearer `JOB_SECRET` |
| `POST /api/jobs/sync-ziora-users` | Usuarios, planes y conteos de la app (cada hora) y seguimientos sugeridos | Bearer `JOB_SECRET` |
| `POST /api/jobs/sync-social` | Métricas de Instagram, Facebook y Meta Ads (diario) | Bearer `JOB_SECRET` |
| `POST /api/webhooks/ziora-help` | "Ayuda y sugerencias" de la app → tickets | HMAC `X-Ops-Signature` |
| `GET /api/health` | Conexión a la BD y a ambos schemas | Pública, sin datos |

## Verlo funcionando en tu PC (5 minutos)

Requisitos: Node 22 y Docker Desktop.

```bash
cp .env.example .env     # ya trae DEV_LOGIN_EMAIL: entras sin Google
docker compose up -d     # Postgres en :5433 con el schema de Event Ops cargado
npm install
npm run db:setup         # migra el schema ops y siembra datos de ejemplo del brief GTM
npm run dev              # http://localhost:3001
```

Los datos de ejemplo son ficticios (correos @example.com). `DEV_LOGIN_EMAIL` solo funciona en desarrollo:
en producción se ignora y el login es con Google.

## Apartados

| Apartado | Qué hace |
|---|---|
| Dashboard | "Mi día" según el rol, bloqueos, KPIs, pipeline, sprint, PRs, bugs, próxima campaña y metas GTM |
| Cuentas y contratos | Clínicas e instituciones: pipeline ponderado, contratos, MRR B2B y alertas de renovación |
| Usuarios de Ziora | Usuarios de la app por plan, actividad, pacientes (solo el número) y MRR estimado |
| Seguimiento 1:1 | Demos de la semana con resultado en un clic, seguimientos agendados y sugeridos |
| Revisión | Cada pieza necesita aprobación de CEO, director clínico y ventas + checklist legal |
| Sugerencias | Ideas de contenido del equipo; al aceptarlas se crean la pieza y la tarea |
| Redes sociales | Seguidores, alcance e interacción por red; mejores publicaciones |
| Anuncios | Gasto, CPL y costo real por demo y por cliente (UTM) |
| Tickets | Cambios e ideas como historia de usuario, con impacto, esfuerzo y viabilidad |
| Tareas | Tablero con arrastrar y soltar, lista, filtros por sprint/épica/persona, sprints, bloqueos |
| Leads | Embudo fijo (nuevo → contactado → respondió → demo → trial → pagó / perdido) con kanban, filtros, selección múltiple, ficha con timeline y toques, "Mi día" con mensaje de WhatsApp prellenado; avanza solo con demos y usuarios de la app; convertir director en cuenta B2B |
| Demos | Pipeline arrastrable, embudo, registro manual, WhatsApp, trial día X/14, tarea de seguimiento |
| Contactos | Base propia (`ops.contacts`), importación desde Event Ops y desde la hoja de leads (CSV, con teléfono), filtros, etiquetas, permiso por canal con evidencia |
| Contenido | Calendario mensual, mezcla 60/25/15, cadencia semanal, checklist legal obligatoria para aprobar |
| Campañas | Segmentos sobre los contactos, destinatarios con opt-in, vista previa, envío y resultados |
| Plantillas | Editor HTML con variables y vista previa en vivo (escritorio/móvil); exige enlace de baja |
| Eventos | Lectura de eventos de Event Ops e "Invitar por correo" |
| QA y bugs | Severidad, estado en línea, detalle, crear tarea desde bug, intake por API |
| Pull requests | PRs por repo con revisión y CI; sincronización manual o por webhook |
| Métricas | Metas día 30/60/90 (manuales o automáticas), demos por semana, embudo, contenido y correo |
| Ajustes | Estado de integraciones con URLs de webhooks, equipo (desde Event Ops) y épicas |

## Roles

Cada persona tiene uno o más roles de Ziora Ops (Ajustes → Equipo): CEO, Ventas, Director clínico, Marketing,
Operaciones y Dev/QA. Deciden el menú, los permisos (`src/lib/permissions.ts`) y el bloque "Mi día".
Un admin de Event Ops puede todo.

## Guías

- `docs/SETUP-CONEXION.md`: base compartida, login, correo, GitHub y calendario de demos.
- `docs/RUNBOOK-CRM-LEADS.md`: llevar el CRM de leads a producción (roles, migraciones 0012/0013, importación MTW, reparto de dueños, verificación, rollback).
- `docs/PUENTE-ZIORA-APP.md`: usuarios y "Ayuda y sugerencias" desde Firebase (con la función de referencia en `docs/firebase/`).
- `docs/REDES-Y-ANUNCIOS.md`: Meta, importación CSV de TikTok/LinkedIn y atribución por UTM.

## Sin Docker

```bash
npm run db:local          # Postgres embebido (PGlite) en :5433; datos en dev/.pglite
# en .env: DB_POOL_MAX=1 (PGlite atiende una conexión a la vez)
npm run db:setup && npm run dev
```

Las pruebas con base (`RUN_DB_TESTS=1 npm run test:db`) escriben datos: córrelas contra una base aparte,
no contra la que usas para ver la app.

## Comandos

```bash
npm run dev          # http://localhost:3001
npm test             # unitarias; con RUN_DB_TESTS=1 y DATABASE_URL también las de integración
npm run typecheck
npm run db:generate  # migración nueva del schema ops
npm run db:migrate
```

## Estado

Hecho: todos los apartados funcionales sobre la base real, webhooks, envío de campañas con consentimiento, sincronización de PRs,
roles, ventas B2B, seguimiento 1:1, revisión y sugerencias de contenido, tickets, puente con la app y redes/anuncios.

Siguiente:
- Desplegar las funciones `opsSnapshot` y `opsHelpRequest` en Firebase (`docs/PUENTE-ZIORA-APP.md`).
- Definir la fuente real de ingresos (¿Stripe?) para reemplazar el MRR estimado.
- Conectores de API de TikTok y LinkedIn cuando aprueben las apps (mientras, CSV).
- Activar la lectura del calendario del CEO (delegación de dominio, `docs/SETUP-CONEXION.md` §10).
- Primer despliegue (`docs/SETUP-CONEXION.md`).
- Adaptador de Sentry (`docs/BUGS.md`).
