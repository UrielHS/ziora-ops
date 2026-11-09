# CRM de leads en Ziora Ops — diseño

**Fecha:** 10-nov-2026 · **Autores:** Chris + Claude · **Dueño del repo:** Uriel (revisa los PRs)
**Diagnóstico previo:** `Ziora code/docs/integraciones/2026-11-10-ziora-ops-diagnostico.md` (lectura completa del repo el 10-nov).

## 1. Intención y por qué

Ziora tiene 0 MRR y una meta de 90,000 MXN/mes al 15-feb-2027. El plan de 90 días dice que Ops es la única fuente de verdad comercial y que Uriel es dueño de la conversión de trial a pago. Hoy Ops tiene contactos estáticos, un kanban de demos y campañas de correo puntuales, pero **no puede dar seguimiento a un lead**: no sabe en qué estado está, de quién es, qué toca hacer hoy ni qué le ha pasado. Los 136 leads de Mexico Tech Week (panel 26-oct, taller 30-oct) llevan dos semanas sin seguimiento sistemático y se enfrían.

Este diseño convierte a Ops en el CRM que lleva un lead desde "nuevo" hasta "pagó", con una pantalla de la mañana para cada dueño, una cadencia de toques con tope, y una API para que Claude pueda operar el seguimiento.

Cómo se ve el éxito: el martes 9 de diciembre a las 9:00 Uriel abre Ops y ve su lista de leads del día con el mensaje redactado y un botón para mandarlo; al terminar la hora, cada toque quedó registrado y el siguiente ya está agendado. Los viernes el tablero saca "contactados, respondieron, en trial, pagaron" sin que nadie lo cuente a mano.

## 2. Metas, no-metas y anti-metas

**Metas**
1. Cada contacto-lead tiene estado fijo, dueño, próxima acción con fecha e historial (timeline).
2. Vista **Hoy**: leads que tocan hoy y atrasados, por dueño, con mensaje prellenado y botones de WhatsApp y correo; marcar hecho registra el toque y agenda el siguiente.
3. Cadencia de 4 toques (día 0, 3, 7, 14) con tope; el correo sale solo; el WhatsApp sale por liga prellenada que abre la persona.
4. El estado avanza solo cuando hay señal: demo agendada (webhook de demos), en trial o pagó (snapshot de usuarios de la app, cruzado por correo).
5. Importar la hoja de leads con contactos **solo con teléfono** y deduplicar por teléfono además de correo.
6. Cerrar el acceso: entra solo quien tiene rol en Ops (o admin); ver/editar/importar contactos y enviar campañas exige permiso.
7. Métricas semanales del embudo en /metrics y en el tablero de los viernes.
8. API v1 con tokens para agentes (Claude): leer leads, cambiar estado, anotar toques, consultar "hoy".
9. Un lead que es director de clínica se convierte en cuenta B2B (módulo Ventas existente) con un clic, sin perder su historial.

**No-metas (por ahora)**
- Bandeja de WhatsApp bidireccional dentro de Ops.
- Sustituir Event Ops o tocar sus tablas `public.*`.
- Automatizar WhatsApp saliente desde Ops en esta entrega (es la fase 4, ver §6).
- App móvil; Ops ya es responsiva.

**Anti-metas (sería un fracaso aunque funcione)**
- Mandar un mensaje a quien se dio de baja o a quien no tiene base de consentimiento registrada.
- Crear contactos duplicados al importar o al recibir webhooks.
- Romper los flujos que Uriel ya usa (demos, campañas, seguimiento 1:1, tickets).
- Que un voluntario de Event Ops vea teléfonos y perfiles de leads.
- Que el estado de un lead retroceda solo (ej. de "pagó" a "contactado") por un sync.

## 3. Restricciones

- Mismo stack y estilo del repo: Next.js 15, Drizzle, Postgres 16, Auth.js, Tailwind, zod, Vitest. UI en español, componentes de `src/components/ui`. Se construye encima de contactos, demos y seguimientos, no como módulo aparte.
- Base compartida con Event Ops: solo se toca el schema `ops.*`. Migraciones idempotentes (`IF NOT EXISTS`) porque producción ya divergió una vez.
- Privacidad (LFPDPPP): los leads son terapeutas, no pacientes; nunca se guarda información clínica. Todo envío lleva baja de un clic. La base de consentimiento de los 136 es el registro en Luma al panel/taller (dieron correo y WhatsApp para ser contactados por el organizador); se registra como consentimiento con `source = evento_luma` y evidencia = nombre del evento. **Decisión de Chris 10-nov: sí se les puede contactar.**
- WhatsApp automatizado (fase 4) solo a quien lo aceptó explícitamente o respondió, por reglas de Meta y LFPDPPP.
- Trabajo en ramas `feat/*` sobre `UrielHS/ziora-ops` (Chris tiene permiso de escritura), PR por fase, Uriel revisa. Deploy automático a Cloud Run al mergear a main.
- Nunca secretos en el repo ni en el chat. El token de Meta vive en Secret Manager de ziora-ehr y no se copia a Ops.

## 4. Decisiones de diseño (tomadas)

### 4.1 El lead vive en `ops.contacts` (no tabla nueva)
Se extiende `ops.contacts` con:
- `lead_status` enum `ops.lead_status`: `nuevo | contactado | respondio | demo_agendada | en_trial | pago | perdido`. Default `nuevo` para contactos con etiqueta `lead`; `null` para contactos que no son leads (sponsors, speakers, etc.).
- `lost_reason` text, `status_changed_at` timestamptz.
- `owner_id` uuid → `public.users.id` (nullable).
- `next_action` text, `next_action_on` date, `last_contact_at` timestamptz.
- `priority` smallint (1 = HOT, 2 = WARM, 3 = COLD) y `segment` text libre (ej. "WARM-A"); recuperan lo que la migración 0009 borró, ahora con uso claro.
- `phone_e164` text generado al guardar (normalización +52 por defecto; misma regla que `ziora-app/src/lib/whatsapp.ts`): índice único parcial `WHERE phone_e164 IS NOT NULL`. `email` ya es nullable y único cuando existe.

**Por qué no una tabla `leads`:** todo lo existente (demos, campañas, consentimientos, tags, importación, webhooks) ya apunta a `contacts`. Una tabla aparte obligaría a duplicar o a joins en cada vista.

### 4.2 Orden de estados y reglas de avance
Orden: nuevo < contactado < respondio < demo_agendada < en_trial < pago. `perdido` es terminal y manual (exige `lost_reason`), salvo baja/queja de correo que marca `perdido` con motivo `baja`.
- Un toque registrado (correo enviado por cadencia, WhatsApp marcado como enviado, llamada) pasa `nuevo → contactado`.
- Botón "Respondió" (o actividad entrante) pasa a `respondio`.
- Webhook de demo `scheduled` → `demo_agendada`; `cancelled` no retrocede, agrega actividad.
- Sync de usuarios de la app: si `app_users.email = contacts.email` (o `phone_e164` coincide con el teléfono del usuario cuando venga en el snapshot) → `en_trial` si el status de Stripe es trialing, `pago` si active con `mrr_cents > 0`.
- Regla general: un sync solo **avanza**; nunca retrocede. Retroceder es manual.
- Cada cambio escribe una actividad `cambio_estado` con de/hacia y actor (usuario o `sistema`).

### 4.3 Timeline: `ops.contact_activities`
`id, contact_id, type enum (nota | whatsapp | correo | llamada | reunion | cambio_estado | demo | campana | secuencia | sistema), direction (saliente | entrante | ninguna), actor_id (nullable, public.users), occurred_at, summary text, meta jsonb`. Se escribe desde acciones, webhooks, sync y cadencia. La ficha del contacto muestra el timeline unificando además `campaign_sends`, `demo_requests` y `followups` existentes (lectura, sin migrar datos viejos).

### 4.4 Cadencia: `ops.sequences`, `ops.sequence_steps`, `ops.sequence_enrollments`
- `sequences`: nombre, activa, `stop_on_reply` (default true), `max_touches` (default 4).
- `sequence_steps`: `sequence_id, position, day_offset (0,3,7,14), channel (email | whatsapp), email_template_id (→ email_templates)` o `whatsapp_text` con las mismas variables `{{nombre}}` etc.
- `sequence_enrollments`: `contact_id, sequence_id, current_step, next_run_at, status (activa | terminada | detenida), stop_reason, enrolled_by`. Índice único (`contact_id`, `sequence_id`) mientras esté activa.
- Job `POST /api/jobs/run-sequences` (Bearer `JOB_SECRET`, Cloud Scheduler cada hora, 8:00–20:00 CDMX):
  - paso `email`: envía individual vía Resend reutilizando `renderTemplate` + `{{{baja}}}` + headers de baja; registra actividad `correo saliente`; avanza `nuevo → contactado`.
  - paso `whatsapp`: **no envía**; crea el "toque pendiente" que aparece en Hoy del dueño con la liga `wa.me` prellenada. Al marcar "enviado" se registra la actividad y avanza el enrollment.
  - Se detiene al: `respondio` o superior, `perdido`, baja de correo, o tope de toques. Al terminar sin respuesta, el lead queda `contactado` con `next_action = "Nutrir por newsletter"` y sin fecha.
- Se enrola desde la ficha, desde selección múltiple en /leads, o al importar (opción "enrolar en secuencia X").
- Una secuencia semilla "MTW 4 toques" con los 4 textos por canal (los redacta Claude; Chris aprueba).

### 4.5 Vistas
- **/leads** (sección Ventas): kanban por `lead_status` reutilizando `src/components/ui/kanban.tsx` y el patrón de `/demos` (arrastrar = cambiar estado; `perdido` pide motivo). Filtros: dueño ("Solo los míos" por defecto), prioridad, origen, etiqueta, ciudad. Selección múltiple: asignar dueño, enrolar en secuencia, cambiar prioridad.
- **/leads/hoy**: lista "Hoy y atrasados" del dueño: nombre, prioridad, toque N de 4, canal, mensaje prellenado (texto visible y copiable), botones WhatsApp (wa.me) y Correo (mandar ahora o "ya lo mandé"), "Respondió", "Posponer", "Perdido". Debajo: "Próximos 7 días". Contador en `MyDay` del dashboard.
- **Ficha del contacto** (drawer/modal existente ampliado): estado, dueño, próxima acción, prioridad, consentimientos por canal, timeline, "Convertir en cuenta" (crea `accounts` + `account_contacts` con `decision_maker = true`, deja el contacto ligado y actividad `sistema`).
- **/metrics**: card "Embudo de leads" por semana: nuevos, contactados, respondieron, demo agendada, en trial, pagaron; tasa contactado→respondió y respondió→trial. Filtro por origen (ej. `sheet_import` MTW).
- **Ajustes → Tokens de API**: emitir/revocar tokens con scopes.

### 4.6 Acceso y permisos
- `requireAccess` exige al menos un rol en `ops.member_roles` o `public.users.role = admin`; si no, página "Pide acceso a Uriel" y cierre de sesión.
- Permisos nuevos en `src/lib/permissions.ts`: `leads.view` (todos los roles), `leads.manage` (sales, ceo, operations, clinical_director, marketing), `contacts.import` (sales, ceo, operations, marketing), `campaigns.send` (marketing, ceo, operations). Las acciones de `contacts.ts`, `demos.ts` y `campaigns.ts` pasan de `requireUser` a `requirePermission`.
- `/api/unsubscribe` por GET muestra confirmación; la baja real es POST (RFC 8058 one-click se conserva).

### 4.7 Importación
- `importLeadsCsv` acepta filas sin correo si traen teléfono válido; deduplica por `email` y luego por `phone_e164`. Reconoce además las columnas de la hoja MTW: `Prioridad`, `Segmento`, `Flag B2B` (→ tag `clinic` si dice Director), `Asistió Panel/Taller` (→ `details.eventos`), `Ticket Panel`.
- Al importar: `source = sheet_import`, `lead_status = nuevo`, consentimiento email y whatsapp con `source = evento_luma` (configurable en el formulario: "¿Con qué base los contactamos?"), opción de dueño por defecto y de enrolar en secuencia.

### 4.8 API v1 para agentes
- `ops.api_tokens`: `id, name, token_hash (sha256), scopes text[], owner_user_id, last_used_at, revoked_at`. Token en claro solo se muestra al crearlo.
- Helper `requireApiToken(req, scope)` siguiendo `isJobAuthorized`. Scopes: `leads:read`, `leads:write`, `activities:write`, `sequences:write`.
- Rutas: `GET /api/v1/leads` (filtros estado/dueño/prioridad/origen, paginado), `GET /api/v1/leads/:id` (con timeline), `PATCH /api/v1/leads/:id` (estado, dueño, próxima acción, prioridad), `POST /api/v1/leads/:id/activities`, `GET /api/v1/leads/hoy?owner=`, `POST /api/v1/leads/:id/enroll`, `POST /api/v1/leads/import` (JSON, mismas reglas que el CSV). Validación zod reutilizando los esquemas de las server actions; mensajes de error en español.
- Toda escritura por API registra actividad con `actor = token:<name>`.

### 4.9 WhatsApp automatizado (fase 4, diseño de alto nivel)
- Ops no habla con Meta. ziora-api expone `POST /api/v1/internal/ops/whatsapp/send` (secreto compartido estilo `X-Sweep-Token`, cuerpo: `to_e164, template, params`), reutilizando `backend/app/integrations/whatsapp_service.py`.
- Plantillas de categoría MARKETING sometidas a Meta (4 toques), con variable de nombre y liga; cada una con opción de baja ("Responde BAJA").
- Solo se manda a contactos con `contact_consents(channel = whatsapp, opt_in = true)` de origen explícito (`respondio_si`, `formulario`), no al de evento.
- Las respuestas llegan al webhook de WhatsApp de ziora-api (ya existe) y se reenvían a Ops como actividad `whatsapp entrante` → `respondio`.

### 4.10 Decisiones tras la revisión del constructor (10-nov)
- **Backfill de contactos existentes (fase 1):** la migración pone `lead_status = nuevo` a los contactos con etiqueta `lead` y sin señal; luego cruza con `demo_requests` (scheduled → `demo_agendada`, trial → `en_trial`, paid → `pago`, lost → `perdido`) y con `app_users` por correo (trialing → `en_trial`, active con MRR → `pago`). Cada asignación escribe una actividad `sistema` "estado inicial por backfill".
- **`phone_e164` en datos existentes (fase 0):** la migración calcula el valor para todos; si dos contactos normalizan al mismo número, el más antiguo lo conserva y los demás quedan con `phone_e164 = null` y una nota `details.telefono_duplicado_de = <id>`. El índice único parcial se crea después de ese paso. Un script `dev/duplicados-telefono.ts` lista los casos para que Uriel los fusione a mano.
- **Sin enums nuevos para MTW:** el origen sigue siendo `sheet_import`; la pertenencia a Mexico Tech Week va en `segment` y `details.eventos`. No se agregan valores a `contact_source` ni a `contact_tag`.
- **Cruce con la app solo por correo en esta entrega.** El snapshot de ziora-api no trae teléfono; agregarlo es un cambio en ziora-gcp que se hace junto con la fase 4. Un lead solo con teléfono avanza a `en_trial`/`pago` a mano hasta entonces.
- **Roles del equipo y permisos:** Chris = admin/ceo, Uriel = operations + dev_qa, Eurídice = sales, Rafa = clinical_director, Ale = marketing, Paulina = operations. `leads.manage` incluye también a `marketing` (Ale es dueña de los COLD). Antes de desplegar la fase 0, el runbook verifica en producción que las seis personas tienen fila en `ops.member_roles`; quien falte se agrega desde Ajustes → Equipo antes del deploy, porque el cierre de acceso saca a quien no tenga rol. Webhooks y jobs no pasan por `requireAccess` (usan HMAC o Bearer) y no se ven afectados.
- **Qué es un toque:** una actividad saliente registrada: correo enviado por la secuencia o a mano, WhatsApp marcado "ya lo mandé", llamada o reunión. "Posponer" no es toque. `max_touches` cuenta pasos de la secuencia ejecutados, no campañas masivas. Un paso de correo con el correo rebotado o ausente se salta y se registra como `sistema`; un paso de WhatsApp sin teléfono igual. Si todos los pasos se saltan, la secuencia termina con motivo `sin_canal`.
- **Baja por cualquier canal:** revoca el consentimiento de ese canal, detiene toda la secuencia activa y marca `perdido` con motivo `baja`. Reabrir es manual y queda en el timeline.
- **API v1:** no hay middleware de sesión en el repo; las rutas `/api/v1/*` solo aceptan Bearer token. Límite de 60 peticiones por minuto por token (contador en memoria, suficiente para un solo Cloud Run) y el job de cadencia manda como máximo 200 correos por corrida para respetar la cuota de Resend.

## 5. Proceso operativo que habilita (no es software, pero fija el diseño)

| Segmento MTW | Leads | Dueño | Primer toque |
|---|---|---|---|
| HOT + WARM-A | 5 | Rafa (WhatsApp personal, nota de voz) | día 0 |
| WARM-B + WARM-C | 20 | Uriel (WhatsApp + correo) | día 0–1 |
| Directores de clínica | 9 | Eurídice (llamada; convertir en cuenta) | esta semana |
| COLD presencial | 75 | Ale (secuencia correo; WhatsApp solo a quien responde) | día 0 |
| COLD virtual | 36 | Ale (secuencia correo) | día 0 |

Viernes: Uriel lee del card de /metrics los 4 números del embudo para el tablero.

## 6. Fases y orden de entrega (cada fase es un PR, cada una deja software usable)

0. **Acceso + importación** (primero, antes de cargar los 136): §4.6 y §4.7, migración de `phone_e164`. Permite cargar la hoja de forma segura.
1. **Lead core**: §4.1–4.3, §4.5 (/leads, ficha, Hoy sin cadencia, convertir en cuenta), avance automático desde demos y app_users.
2. **Cadencia**: §4.4 y Hoy completo; secuencia semilla MTW; job y scheduler.
3. **Métricas + API v1**: §4.5 métricas, §4.8, documentación `docs/API-V1.md` y runbook para que Claude opere.
4. **WhatsApp automatizado**: §4.9 (requiere PR en ziora-gcp y plantillas aprobadas por Meta).

## 7. Lo que queda al constructor
- Diseño exacto de pantallas dentro del sistema visual existente; textos de la UI.
- Nombres de funciones de dominio y organización de archivos siguiendo `src/domain` + `src/actions`.
- Estrategia de pruebas: unitarias de dominio obligatorias (transiciones de estado, cadencia, normalización de teléfono, dedupe), integración con `RUN_DB_TESTS=1`.
- Formato exacto de los 4 mensajes de la secuencia semilla (Claude redacta, Chris aprueba antes de sembrar).
- Cómo mostrar en la ficha los datos históricos de `campaign_sends`/`followups` sin migrarlos.
