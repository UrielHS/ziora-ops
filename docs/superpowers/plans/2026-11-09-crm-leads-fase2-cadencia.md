# CRM de leads · Fase 2 (Cadencia) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un lead enrolado en una secuencia reciba solo sus correos y le aparezca al dueño el toque de WhatsApp listo en "Mi día", hasta que responda, se pierda, se dé de baja o se acaben los toques.

**Architecture:** Tres tablas nuevas en `ops` (`sequences`, `sequence_steps`, `sequence_enrollments`) y un dominio `src/domain/sequences.ts` con dos entradas: `enroll` (ficha, kanban, importación) y `runSequences` (job horario `POST /api/jobs/run-sequences`, Bearer `JOB_SECRET`). Los pasos de correo se mandan con la misma tubería que las campañas (`renderTemplate` + `sendBatch` + liga de baja); los pasos de WhatsApp no se envían: quedan como "toque pendiente" en el enrollment y en `next_action` del contacto, que es lo que ya pinta `/leads/hoy`. La parada automática vive en `src/domain/leads.ts` (cambio de estado), para que ningún camino la salte.

**Tech Stack:** Next.js 15.5 App Router, Drizzle + postgres-js (PGlite local), zod 4, Vitest, Resend, Cloud Scheduler.

**Spec:** `docs/superpowers/specs/2026-11-10-crm-leads-design.md` (§4.4 cadencia, §4.5 vistas Hoy/kanban/ficha, §4.10 "qué es un toque", "baja por cualquier canal", límite de 200 correos por corrida).

## Global Constraints

- Rama `feat/crm-cadencia` desde `main` (1cdb8d6, fases 0+1 en prod). Un PR. Mensajes de commit y textos de UI en español; cada commit termina con `Claude-Session: https://claude.ai/code/session_01XR484AQFoFhRCpRNg2j1Bi`.
- Finales de línea: el repo mezcla CRLF y LF por archivo. Archivo existente → conservar su estilo. Archivo nuevo → LF. Verificar con `git diff --stat` que un cambio de una línea no aparezca como archivo completo.
- No tocar `public.*`. Migración idempotente generada con `npm run db:generate` → `drizzle/0014_cadencia.sql` (revisar el SQL; el journal debe quedar con tag `0014_cadencia`).
- Los server actions devuelven `{ error }` vía `formAction`, nunca lanzan. Mensajes de zod en español.
- Horario de envío: 8:00–20:00 America/Mexico_City (UTC-6 fijo, sin horario de verano). Máximo **200** correos por corrida del job. `max_touches` default **4**, `stop_on_reply` default **true**. Offsets de la semilla: **0, 3, 7, 14** días.
- Un toque = actividad saliente registrada (correo enviado, WhatsApp marcado "ya lo mandé"). Un paso omitido no es toque. Si todos los pasos se omiten, la secuencia termina con `stop_reason = "sin_canal"`.
- Al terminar sin respuesta: lead queda `contactado` (si ya lo estaba) con `next_action = "Nutrir por newsletter"` y `next_action_on = null`.
- Pruebas: unitarias con `npx vitest run <archivo>`; con base: `export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); RUN_DB_TESTS=1 DB_POOL_MAX=1 npx vitest run --no-file-parallelism <archivo>` (PGlite en :5433 levantado con `npm run db:local`; migrar con `npm run db:migrate`). Antes de `npm run build`, matar el dev server (comparten `.next`).
- La semilla de producción (secuencia "MTW 4 toques") **no se siembra sin la aprobación de Chris a los 4 textos** (spec §7). Local sí.

## Review Focus

1. El lead responde entre dos corridas del job (estado `respondio` o superior): la corrida siguiente **no** manda el correo pendiente y el enrollment queda `detenida` con motivo `respondio`. (Task 3, prueba "una respuesta detiene la secuencia antes del siguiente paso".)
2. El correo rebota a mitad de secuencia (consentimiento `email` en `opt_in = false`, source `bounce`): el paso de correo se omite con actividad `sistema`, el siguiente paso de WhatsApp sí se programa. (Task 3, prueba "correo rebotado: se omite el paso y sigue el WhatsApp".)
3. Lead sin ninguno de los canales que la secuencia necesita: termina `sin_canal`, sin poner "Nutrir por newsletter" como si se le hubiera escrito. (Task 3, prueba "sin ningún canal termina sin_canal".)
4. Dos corridas del job se encabalgan (Cloud Scheduler reintenta): la segunda no manda el mismo correo. (Task 3: `runSequences` reserva la fila con `for update skip locked` y adelanta `next_run_at` **antes** de enviar; prueba "dos corridas seguidas no duplican el envío".)
5. El dueño nunca marca el WhatsApp pendiente: el enrollment no se queda colgado para siempre. Un pendiente con más de **7 días** se omite con actividad `sistema` y la secuencia sigue. (Task 3, prueba "un WhatsApp pendiente más de 7 días se omite y la secuencia sigue".)

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/db/schema.ts` | Enums `sequence_channel`, `enrollment_status`; tablas `sequences`, `sequenceSteps`, `sequenceEnrollments` |
| `drizzle/0014_cadencia.sql` | Migración generada |
| `src/domain/sequences.ts` | `computeNextRunAt`, `inSendingWindow`, `cadenceVars`, `renderWhatsapp`, `touchLabel`, `enroll`, `completePendingTouch`, `runSequences`, `loadCadence` |
| `src/domain/sequences.test.ts` | Unitarias de las funciones puras |
| `src/domain/sequences.integration.test.ts` | Esquema, enrolar, job, paradas, pendientes |
| `src/domain/leads.ts` | `stopActiveEnrollments` + llamada desde `setLeadStatus`/`advanceLead` |
| `src/domain/lead-sheet.ts` | `importLeadSheet` acepta `sequenceId` |
| `src/app/api/jobs/run-sequences/route.ts` | Job horario |
| `src/actions/sequences.ts` | `enrollAction`, `stopEnrollmentAction` |
| `src/actions/leads.ts` | `_recordTouch` completa el toque pendiente; `_bulk` acepta `op = "enroll"` |
| `src/actions/contacts.ts` | `_importLeads` acepta `sequenceId` |
| `src/components/leads.tsx` | `TodayRow` muestra toque N de M y canal; `CadencePanel` en la ficha |
| `src/app/(app)/leads/hoy/page.tsx` | Trae el pendiente de cadencia por lead |
| `src/app/(app)/leads/[id]/page.tsx` | Panel "Cadencia" |
| `src/app/(app)/leads/page.tsx` | Selector de secuencia en la acción masiva |
| `src/app/(app)/leads/secuencias/page.tsx` | Lista de secuencias, pasos y conteos (solo lectura) |
| `src/app/(app)/contacts/page.tsx` | Select "Enrolar en secuencia" en el modal de importación |
| `src/app/(app)/settings/page.tsx` | Fila "Cadencia de leads" en Integraciones |
| `src/lib/labels.ts` | `ENROLLMENT_STATUS`, `SEQUENCE_CHANNEL` |
| `dev/seed-secuencia-mtw.ts` | Siembra plantillas + secuencia "MTW 4 toques" (idempotente por nombre) |
| `docs/secuencia-mtw.md` | Los 4 textos para aprobación de Chris |
| `docs/RUNBOOK-CRM-LEADS.md` | §7 Fase 2: scheduler, semilla, verificación, rollback |

---

### Task 1: Esquema y migración

**Files:**
- Modify: `src/db/schema.ts` (después de `contactActivities`)
- Create: `drizzle/0014_cadencia.sql` (generado)
- Modify: `src/lib/labels.ts` (junto a `LEAD_PRIORITY`)
- Test: `src/domain/sequences.integration.test.ts` (solo la prueba de esquema)

**Interfaces:**
- Produces:
  - `sequenceChannelEnum = ops.enum("sequence_channel", ["email", "whatsapp"])`, `enrollmentStatusEnum = ops.enum("enrollment_status", ["activa", "terminada", "detenida"])`; tipos `SequenceChannel`, `EnrollmentStatus`.
  - `sequences`: `id, name text notNull, active boolean notNull default true, stopOnReply boolean notNull default true, maxTouches integer notNull default 4, createdBy uuid → users set null, ...timestamps()`. Índice único `sequences_name_unique` en `name`.
  - `sequenceSteps`: `id, sequenceId uuid notNull → sequences cascade, position integer notNull, dayOffset integer notNull, channel sequenceChannelEnum notNull, emailTemplateId uuid → emailTemplates set null, whatsappText text`. Índice único `sequence_steps_position_unique (sequenceId, position)`.
  - `sequenceEnrollments`: `id, contactId uuid notNull → contacts cascade, sequenceId uuid notNull → sequences cascade, currentStep integer notNull default 1` (posición del próximo paso a ejecutar), `nextRunAt timestamptz`, `status enrollmentStatusEnum notNull default "activa"`, `stopReason text`, `touches integer notNull default 0`, `pendingStepId uuid → sequenceSteps set null`, `pendingText text`, `pendingSince timestamptz`, `enrolledBy uuid → users set null`, `enrolledAt timestamptz notNull defaultNow()`, `...timestamps()`. Índice único parcial `enrollments_active_unique` en `(contactId, sequenceId)` where `status = 'activa'`; índice `enrollments_due_idx` en `(status, nextRunAt)`.
  - Tipos: `Sequence`, `SequenceStep`, `SequenceEnrollment` (`$inferSelect`).
  - `ENROLLMENT_STATUS = { activa: {label:"Activa", tone:"emerald"}, terminada: {label:"Terminada", tone:"gray"}, detenida: {label:"Detenida", tone:"amber"} }`, `SEQUENCE_CHANNEL = { email: "Correo", whatsapp: "WhatsApp" }` en `labels.ts`.

- [ ] **Step 1: Prueba de esquema (roja)**

```ts
// src/domain/sequences.integration.test.ts
describe.runIf(enabled)("cadencia: esquema", () => {
  it("un contacto no puede tener dos enrollments activos en la misma secuencia", async () => {
    const { db } = await import("@/db");
    const { sequences, sequenceEnrollments } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const t = Date.now();
    const [seq] = await db.insert(sequences).values({ name: `Prueba ${t}` }).returning();
    const { id } = await upsertContact(db, { name: "Enrolado", email: `enr${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id });
    await expect(db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id })).rejects.toThrow(/enrollments_active_unique|duplicate key/);
    await db.update(sequenceEnrollments).set({ status: "terminada" }).where(eq(sequenceEnrollments.contactId, id));
    await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id }); // ya no choca
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); RUN_DB_TESTS=1 DB_POOL_MAX=1 npx vitest run --no-file-parallelism src/domain/sequences.integration.test.ts`
Expected: FAIL — `sequences` no existe en `@/db/schema`.

- [ ] **Step 3: Agregar enums, tablas, tipos y labels** según Interfaces. Generar la migración:

Run: `npm run db:generate` → renombrar el archivo generado a `drizzle/0014_cadencia.sql` **y** ajustar `drizzle/meta/_journal.json` (tag `0014_cadencia`) y el snapshot si drizzle-kit no lo hizo. Revisar que el SQL cree el índice único parcial con `WHERE status = 'activa'`.

- [ ] **Step 4: Migrar local y correr la prueba**

Run: `npm run db:migrate && export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); RUN_DB_TESTS=1 DB_POOL_MAX=1 npx vitest run --no-file-parallelism src/domain/sequences.integration.test.ts`
Expected: PASS (1 test). `npm run typecheck` sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/0014_cadencia.sql drizzle/meta src/lib/labels.ts src/domain/sequences.integration.test.ts
git commit -m "feat(cadencia): tablas sequences, sequence_steps y sequence_enrollments (migración 0014)"
```

---

### Task 2: Funciones puras de la cadencia

**Files:**
- Create: `src/domain/sequences.ts`
- Test: `src/domain/sequences.test.ts`

**Interfaces:**
- Produces:
  - `computeNextRunAt(enrolledAt: Date, dayOffset: number, now: Date): Date` — `dayOffset === 0` → `now`; si no, las **10:00** hora CDMX del día `enrolledAt + dayOffset` (fecha calculada en zona `America/Mexico_City`, construida como `${YYYY-MM-DD}T10:00:00-06:00`); si ese instante ya pasó respecto a `now`, devuelve `now`.
  - `inSendingWindow(now: Date): boolean` — hora CDMX `08:00 ≤ h < 20:00`.
  - `cadenceVars(c: { name: string; email: string | null; cityName: string | null }, ownerName: string | null): TemplateVars` — `{ nombre: firstName(name), nombre_completo: name, email, ciudad: cityName, remitente: ownerName ? firstName(ownerName) : "el equipo de Ziora" }`.
  - `renderWhatsapp(text: string, vars: TemplateVars): string` — `renderTemplate` y luego des-escapa `&amp; &lt; &gt; &quot; &#39;` porque WhatsApp es texto plano.
  - `touchLabel(touch: number, total: number, channel: "email" | "whatsapp"): string` → `"Toque 2 de 4 · WhatsApp"` / `"… · Correo"`.

- [ ] **Step 1: Pruebas unitarias (rojas)**

```ts
// src/domain/sequences.test.ts
import { describe, expect, it } from "vitest";
import { cadenceVars, computeNextRunAt, inSendingWindow, renderWhatsapp, touchLabel } from "./sequences";

describe("computeNextRunAt", () => {
  const enrolled = new Date("2026-11-09T22:30:00-06:00");
  it("offset 0 corre ya", () => { expect(computeNextRunAt(enrolled, 0, enrolled).toISOString()).toBe(enrolled.toISOString()); });
  it("offset 3 son las 10:00 CDMX tres días después", () => {
    expect(computeNextRunAt(enrolled, 3, enrolled).toISOString()).toBe(new Date("2026-11-12T10:00:00-06:00").toISOString());
  });
  it("si la hora calculada ya pasó, corre ya", () => {
    const now = new Date("2026-11-13T09:00:00-06:00");
    expect(computeNextRunAt(enrolled, 3, now).toISOString()).toBe(now.toISOString());
  });
});

describe("inSendingWindow", () => {
  it("8:00 sí, 19:59 sí, 20:00 no, 7:59 no (CDMX)", () => {
    expect(inSendingWindow(new Date("2026-11-10T08:00:00-06:00"))).toBe(true);
    expect(inSendingWindow(new Date("2026-11-10T19:59:00-06:00"))).toBe(true);
    expect(inSendingWindow(new Date("2026-11-10T20:00:00-06:00"))).toBe(false);
    expect(inSendingWindow(new Date("2026-11-10T07:59:00-06:00"))).toBe(false);
  });
});

describe("variables y WhatsApp", () => {
  it("remitente es el nombre de pila del dueño o el equipo", () => {
    expect(cadenceVars({ name: "Ana López", email: "a@x.mx", cityName: "CDMX" }, "Uriel Hernández")).toMatchObject({ nombre: "Ana", remitente: "Uriel", ciudad: "CDMX" });
    expect(cadenceVars({ name: "Ana", email: null, cityName: null }, null).remitente).toBe("el equipo de Ziora");
  });
  it("renderWhatsapp no deja entidades HTML", () => {
    expect(renderWhatsapp("Hola {{nombre}} & co", { nombre: "Ana \"la\" <jefa>" })).toBe('Hola Ana "la" <jefa> & co');
  });
  it("touchLabel", () => { expect(touchLabel(2, 4, "whatsapp")).toBe("Toque 2 de 4 · WhatsApp"); });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/domain/sequences.test.ts`
Expected: FAIL — módulo `./sequences` no existe.

- [ ] **Step 3: Implementar** las cinco funciones en `src/domain/sequences.ts` (importa `firstName`, `renderTemplate`, `TemplateVars` de `./template`; zona horaria con `Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" })` para la fecha y `{ hour: "numeric", hour12: false }` para la hora).

- [ ] **Step 4: Correr**

Run: `npx vitest run src/domain/sequences.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/sequences.ts src/domain/sequences.test.ts
git commit -m "feat(cadencia): cálculo de próximo paso, ventana de envío y variables de WhatsApp"
```

---

### Task 3: Dominio: enrolar, correr el job, parar y completar toques

**Files:**
- Modify: `src/domain/sequences.ts`
- Modify: `src/domain/leads.ts` (`setLeadStatus`, `advanceLead`, nueva `stopActiveEnrollments`)
- Test: `src/domain/sequences.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (tablas), Task 2 (puras); `leads.ts`: `logActivity`, `advanceLead`, `recordTouch`, `Actor`, `SYSTEM_ACTOR`; patrón de envío de `campaigns.ts`; `@/integrations/resend` `sendBatch(from, emails)` y tipo `OutgoingEmail`; `@/lib/crypto` `unsubscribeToken`; `@/lib/env` `requireEnv("APP_URL" | "UNSUBSCRIBE_SECRET" | "MAIL_FROM")`; `contacts.ts` `optOut` (ya llama `setLeadStatus("perdido", { lostReason: "baja" })`), `emailBounced` (solo quita consentimiento).
- Produces (en `leads.ts`):
  - `stopActiveEnrollments(db: Dbx, contactId: string, reason: string): Promise<number>` — `status = "detenida"`, `stopReason = reason`, `nextRunAt = null`, limpia `pending*`; actividad `secuencia` "Secuencia detenida: <reason>" por enrollment; devuelve cuántos. Se llama desde `setLeadStatus` cuando `to ∉ {nuevo, contactado}` con `reason = opts.lostReason === "baja" ? "baja" : to`, y desde `advanceLead` cuando avanza a un estado con índice `≥ respondio` en `LEAD_ORDER` (`reason = to`).
- Produces (en `sequences.ts`):
  - `enroll(db: Dbx, contactIds: string[], sequenceId: string, actor: Actor, now = new Date()): Promise<{ enrolled: number; skipped: { contactId: string; reason: "estado" | "ya_enrolado" | "secuencia_inactiva" }[] }>` — solo leads en `nuevo` o `contactado`; crea el enrollment con `currentStep = primer position`, `nextRunAt = computeNextRunAt(now, step1.dayOffset, now)`, `enrolledBy = actor.userId`; actividad `secuencia` "Enrolado en «<name>»" con `meta.sequenceId`.
  - `type Sender = (from: string, emails: OutgoingEmail[]) => Promise<(string | null)[]>`.
  - `runSequences(db: Db, opts: { now?: Date; limit?: number; send?: Sender } = {}): Promise<{ sent: number; pendingWhatsapp: number; skipped: number; finished: number; stopped: number }>` — algoritmo:
    1. Si `!inSendingWindow(now)` → devuelve ceros.
    2. Pendientes viejos: enrollments `activa` con `pendingSince < now − 7 días` → actividad `sistema` "WhatsApp del toque N no se marcó en 7 días: se omite", limpiar `pending*`, avanzar paso (regla 5), `skipped++`.
    3. Reserva en transacción corta: `select id from ops.sequence_enrollments where status='activa' and pending_since is null and next_run_at <= $now order by next_run_at limit $limit for update skip locked`; a esas filas `next_run_at = now + 1 hora`. Una corrida encabalgada no las ve.
    4. Por cada enrollment reservado (cargar secuencia, pasos ordenados, contacto, consentimientos, nombre del dueño):
       - Lead ya no en `nuevo`/`contactado` → `stopActiveEnrollments(reason = leadStatus)`; `stopped++`.
       - `touches >= maxTouches` → terminar con `stopReason = "tope"`.
       - Paso `email`: requiere `contact.email` y consentimiento `email` con `optIn = true`. Si falta → actividad `sistema` "Paso N de correo omitido: sin correo o sin permiso", avanzar paso sin toque, `skipped++`. Si está: `vars = { ...cadenceVars(c, ownerName), baja: unsubscribeUrl }` (misma construcción de `unsubscribeUrl` que `sendCampaign`), asunto/HTML con `renderTemplate`; `send(from, [{ to, subject, html, unsubscribeUrl, tags: [{ name: "sequence", value: sequenceId }] }])`; luego `recordTouch(db, contactId, "correo", SYSTEM_ACTOR, "Secuencia «<name>» · toque N: <asunto>")` (deja `lastContactAt`, avanza a `contactado`, actividad `correo` saliente con `meta.sequenceId`); `touches++`; `sent++`; avanzar paso. Si `send` lanza: actividad `sistema` "Paso N de correo falló: <msg>", `nextRunAt = now + 1 hora`, sin avanzar.
       - Paso `whatsapp`: requiere `phoneE164` y consentimiento `whatsapp` `optIn = true`. Si falta → omitir igual. Si está: `pendingStepId = step.id`, `pendingText = renderWhatsapp(step.whatsappText, vars)`, `pendingSince = now`, `nextRunAt = null`; contacto `nextAction = touchLabel(touches + 1, total, "whatsapp")`, `nextActionOn = hoy CDMX`; `pendingWhatsapp++`. No avanza paso.
    5. Avanzar paso = `currentStep = siguiente position`. Sin siguiente → terminar: `status = "terminada"`, `stopReason = touches === 0 ? "sin_canal" : "completada"`, `nextRunAt = null`; contacto `nextAction = touches === 0 ? null : "Nutrir por newsletter"`, `nextActionOn = null`; actividad `secuencia` "Secuencia terminada sin respuesta" o "Secuencia terminada: ningún canal disponible"; `finished++`. Con siguiente → `nextRunAt = computeNextRunAt(enrolledAt, next.dayOffset, now)`. **Tras un paso omitido**, si ese `nextRunAt ≤ now`, el siguiente paso se procesa en la misma corrida (así "sin canal" termina en una sola corrida); tras un paso ejecutado o dejado pendiente, no. `total` = número de pasos de la secuencia.
  - `completePendingTouch(db: Dbx, contactId: string, channel: "whatsapp" | "correo", now = new Date()): Promise<boolean>` — enrollment `activa` del contacto con `pendingStepId` cuyo paso sea del canal (`whatsapp`↔`whatsapp`, `correo`↔`email`); si no hay → `false`. Si hay: `touches++`, limpia `pending*`, avanza paso (regla 5), actividad `secuencia` "Toque N de M por WhatsApp marcado como enviado"; `true`. No registra el toque: eso lo hace `recordTouch` desde el action.
  - `loadCadence(db: Dbx, contactIds: string[]): Promise<Map<string, Cadence>>` con `type Cadence = { enrollmentId: string; sequenceName: string; status: EnrollmentStatus; touches: number; total: number; nextRunAt: Date | null; nextChannel: SequenceChannel | null; pendingText: string | null; stopReason: string | null }` — el enrollment más reciente por contacto (activa primero).

- [ ] **Step 1: Pruebas de integración (rojas)** — en `sequences.integration.test.ts`, helper `mkSequence(db, t, steps?)` que inserta plantilla `Tpl ${t}` (`subject: "Hola {{nombre}}"`, `html: '<p>{{nombre}} <a href="{{{baja}}}">baja</a></p>'`) y secuencia `MTW ${t}` con pasos por defecto `[0 email, 3 whatsapp "Hola {{nombre}}, soy {{remitente}}", 7 email, 14 whatsapp "¿Sigue en pie, {{nombre}}?"]`; `fakeSend` que guarda `{from, emails}` y devuelve `["id-1"]`; `process.env.APP_URL ??= "http://localhost:3001"`, `UNSUBSCRIBE_SECRET ??= "test"`, `MAIL_FROM ??= "Ziora <hola@test>"`. `NOW = new Date("2026-11-10T10:00:00-06:00")` (dentro de la ventana).

```ts
it("enrolar: solo nuevo/contactado, sin duplicar, deja actividad y programa el paso 0 para ya")
  // contactos nuevo / en_trial / nuevo-ya-enrolado → enrolled 1; skipped reasons ["estado","ya_enrolado"]; nextRunAt <= NOW; actividad type "secuencia".
it("paso de correo: manda con liga de baja, deja toque, pasa a contactado y programa el WhatsApp del día 3 a las 10:00")
  // runSequences({ now: NOW, send: fakeSend }) → sent 1; fakeSend.calls[0].emails[0].html contiene "/api/unsubscribe?t="; leadStatus "contactado"; enrollment currentStep 2, touches 1, nextRunAt = computeNextRunAt(enrolledAt, 3, NOW); actividad "correo" saliente.
it("paso de WhatsApp: no envía, deja pendiente y siguiente paso en el contacto; completar avanza")
  // forzar currentStep 2 y nextRunAt NOW → run → pendingWhatsapp 1, pendingText "Hola Ana, soy Uriel" (dueño con nombre "Uriel Prueba"), contact.nextAction "Toque 2 de 4 · WhatsApp", nextActionOn hoy; completePendingTouch(db, id, "whatsapp") → true, touches 2, currentStep 3, pending null; segunda llamada → false.
it("una respuesta detiene la secuencia antes del siguiente paso")
  // markReplied → enrollment detenida, stopReason "respondio"; run → sent 0.
it("correo rebotado: se omite el paso y sigue el WhatsApp")
  // emailBounced(db, email) antes del run → skipped 1, sent 0, actividad sistema /omitido/, currentStep 2 con nextRunAt programado.
it("sin ningún canal termina sin_canal")
  // sin teléfono y consentimiento email opt_in false; secuencia [0 email, 0 whatsapp] → run → terminada, stopReason "sin_canal", contact.nextAction null.
it("fin sin respuesta deja 'Nutrir por newsletter'")
  // secuencia de 1 paso email → run → terminada "completada", nextAction "Nutrir por newsletter", nextActionOn null.
it("tope de toques termina la secuencia")
  // maxTouches 1, secuencia [0 email, 0 email] → primera corrida envía; segunda → terminada "tope", sent 0.
it("dos corridas seguidas no duplican el envío")
  // runSequences(NOW) dos veces con fakeSend → total sent 1 (la segunda ve next_run_at adelantado).
it("un WhatsApp pendiente más de 7 días se omite y la secuencia sigue")
  // pendingSince = NOW − 8 días → run → skipped 1, pending null, currentStep avanzado, actividad sistema /7 días/.
it("fuera de horario no hace nada")
  // now 21:00 CDMX → ceros.
it("baja de correo detiene la secuencia con motivo baja")
  // optOut(db, id) → detenida "baja", lead perdido.
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); RUN_DB_TESTS=1 DB_POOL_MAX=1 npx vitest run --no-file-parallelism src/domain/sequences.integration.test.ts`
Expected: FAIL — `enroll`/`runSequences`/`completePendingTouch` no exportados.

- [ ] **Step 3: Implementar** `stopActiveEnrollments` y los hooks en `leads.ts`; `enroll`, `runSequences`, `completePendingTouch`, `loadCadence` en `sequences.ts`. `sequences.ts` importa de `./leads`; `leads.ts` no importa de `./sequences` (sin ciclo). El `for update skip locked` va con `sql` crudo de drizzle.

- [ ] **Step 4: Correr todo**

Run: `export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); RUN_DB_TESTS=1 DB_POOL_MAX=1 npx vitest run --no-file-parallelism` y `npx vitest run`
Expected: PASS todo. `npm run typecheck` limpio.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sequences.ts src/domain/leads.ts src/domain/sequences.integration.test.ts
git commit -m "feat(cadencia): enrolar, correr pasos de correo y WhatsApp, paradas automáticas y toques pendientes"
```

---

### Task 4: Job `run-sequences` y fila en Ajustes

**Files:**
- Create: `src/app/api/jobs/run-sequences/route.ts`
- Modify: `src/app/(app)/settings/page.tsx` (lista de integraciones)
- Test: `src/app/api/jobs/run-sequences/route.test.ts`

**Interfaces:**
- Consumes: `runSequences(db, { now, limit: 200 })`, `isJobAuthorized`, `inSendingWindow`.
- Produces: `POST /api/jobs/run-sequences` → 401 sin Bearer; fuera de horario `{ ok: true, skippedWindow: true }` sin tocar la base; si no, `{ ok: true, sent, pendingWhatsapp, skipped, finished, stopped }`. `export const maxDuration = 300`.

- [ ] **Step 1: Prueba (roja)** — `vi.mock("@/domain/sequences", …)` (`runSequences` → `{ sent: 2, … }`, `inSendingWindow` → true) y `vi.mock("@/db")`:

```ts
it("401 sin Bearer; con Bearer llama runSequences con limit 200 y devuelve los conteos", async () => {
  process.env.JOB_SECRET = "s3cret";
  const { POST } = await import("./route");
  expect((await POST(new Request("http://x/api/jobs/run-sequences", { method: "POST" }))).status).toBe(401);
  const res = await POST(new Request("http://x/api/jobs/run-sequences", { method: "POST", headers: { authorization: "Bearer s3cret" } }));
  expect(await res.json()).toMatchObject({ ok: true, sent: 2 });
  expect(runSequences).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 200 }));
});
```

- [ ] **Step 2: Correr y ver que falla** — Run: `npx vitest run src/app/api/jobs/run-sequences/route.test.ts` — Expected: FAIL, módulo no existe.

- [ ] **Step 3: Implementar el route** (misma forma que `send-campaign/route.ts`) y en Ajustes → Integraciones la fila `Cadencia de leads · Cloud Scheduler cada hora 8–20 · <APP_URL>/api/jobs/run-sequences · Conectado si JOB_SECRET y RESEND_API_KEY existen`.

- [ ] **Step 4: Correr** — Run: `npx vitest run src/app/api/jobs/run-sequences/route.test.ts && npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/run-sequences "src/app/(app)/settings/page.tsx"
git commit -m "feat(cadencia): job horario run-sequences y fila en Ajustes"
```

---

### Task 5: Actions: enrolar desde kanban y ficha, detener, completar el toque

**Files:**
- Create: `src/actions/sequences.ts`
- Modify: `src/actions/leads.ts` (`_recordTouch`, `_bulk`)
- Test: `src/actions/sequences.test.ts`

**Interfaces:**
- Consumes: `enroll`, `completePendingTouch`, `stopActiveEnrollments`, `formAction`, `requirePermission("leads.manage")`.
- Produces:
  - `enrollAction(prev, fd)` con `{ ids: uuid[] (min 1, "elige al menos un lead"), sequenceId: uuid }` → `"N lead(s) enrolado(s)"` y, si hubo omitidos, `" · M omitido(s) (ya enrolados o fuera de nuevo/contactado)"`.
  - `stopEnrollmentAction(prev, fd)` con `{ id: uuid }` → `stopActiveEnrollments(db, id, "manual")` → `"Secuencia detenida"`.
  - `_bulk` acepta `op: "enroll"` + `sequenceId` y reutiliza la misma función interna `enrollMany(ids, sequenceId)`.
  - `_recordTouch`: tras `recordTouch(...)`, si `channel` es `whatsapp` o `correo`, `await completePendingTouch(db, d.id, d.channel)`.
  - Todas llaman `refresh(id)`; `refresh` también revalida `/leads/hoy` (ya cubierto por `revalidatePath("/leads", "layout")`).

- [ ] **Step 1: Prueba (roja)** — con `vi.mock("@/domain/sequences")`, `vi.mock("@/lib/session")` (permiso concedido, user `{ id, name }`) y `vi.mock("@/db")`:

```ts
it("enrollAction exige al menos un lead y una secuencia, y resume enrolados/omitidos", async () => {
  const fd = new FormData(); fd.append("sequenceId", SEQ);
  expect((await enrollAction({}, fd)).error).toMatch(/elige al menos un lead/);
  fd.append("ids[]", ID1); fd.append("ids[]", ID2);
  vi.mocked(enroll).mockResolvedValue({ enrolled: 1, skipped: [{ contactId: ID2, reason: "estado" }] });
  expect((await enrollAction({}, fd)).message).toBe("1 lead(s) enrolado(s) · 1 omitido(s) (ya enrolados o fuera de nuevo/contactado)");
});
```
(Verificar primero cómo `formAction` y `_bulk` leen `ids[]` para que la prueba use el mismo nombre de campo.)

- [ ] **Step 2: Correr y ver que falla** — Run: `npx vitest run src/actions/sequences.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar** según Interfaces.

- [ ] **Step 4: Correr** — Run: `npx vitest run src/actions && npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/sequences.ts src/actions/sequences.test.ts src/actions/leads.ts
git commit -m "feat(cadencia): acciones de enrolar, detener y completar el toque pendiente"
```

---

### Task 6: UI: Hoy con toque N de M, panel Cadencia en la ficha, kanban y lista de secuencias

**Files:**
- Modify: `src/components/leads.tsx` (`TodayRow` prop `cadence`, nuevo `CadencePanel`)
- Modify: `src/app/(app)/leads/hoy/page.tsx`
- Modify: `src/app/(app)/leads/[id]/page.tsx`
- Modify: `src/app/(app)/leads/page.tsx` (acción masiva y enlace "Secuencias")
- Create: `src/app/(app)/leads/secuencias/page.tsx`
- Test: `src/components/leads.test.tsx`

**Interfaces:**
- Consumes: `loadCadence`, `Cadence`, `touchLabel`, `enrollAction`, `stopEnrollmentAction`, `bulkLeadsAction` (op `enroll`), `ENROLLMENT_STATUS`, `SEQUENCE_CHANNEL`.
- Produces:
  - `TodayRow({ c, owner, message, wa, cadence?: Cadence })`: con `cadence.pendingText` → el textarea muestra `pendingText`, el enlace WhatsApp se arma con ese texto (la página pasa `wa = waMessageLink(phone, pendingText ?? message)`), y una `Badge tone="emerald"` con `touchLabel(touches + 1, total, "whatsapp")`. Con cadencia sin pendiente → `Badge tone="gray"` `Secuencia «X» · siguiente: <Correo|WhatsApp> <fecha corta>`.
  - `CadencePanel({ contactId, cadence, sequences, canManage })`: badge `ENROLLMENT_STATUS`, `N de M toques`, siguiente paso, botón "Detener" (`stopEnrollmentAction`) si activa; si no hay activa y `canManage`: `Select name="sequenceId"` de secuencias activas + Submit "Enrolar" (`enrollAction`, `ids[]` = contactId).
  - Kanban: tercera fila en la acción masiva: `Select name="sequenceId"` + `Submit name="op" value="enroll"` "Enrolar en secuencia". Enlace `Secuencias` → `/leads/secuencias` en la cabecera de `/leads` y `/leads/hoy`.
  - `/leads/secuencias`: `requirePagePermission("leads.view")`; por secuencia: nombre, activa, pasos (posición, día, canal, nombre de plantilla o primeros 60 caracteres del texto), conteos activa/terminada/detenida y correos enviados (actividades `correo` con `meta.sequenceId`).

- [ ] **Step 1: Prueba de render (roja)** — con `renderToStaticMarkup` de `react-dom/server` (sin dependencias nuevas):

```tsx
it("TodayRow con WhatsApp pendiente muestra el toque y el texto de la secuencia", () => {
  const html = renderToStaticMarkup(<TodayRow c={lead} owner="Uriel" message="default" wa={null} cadence={{ enrollmentId: "e", sequenceName: "MTW", status: "activa", touches: 1, total: 4, nextRunAt: null, nextChannel: "whatsapp", pendingText: "Hola Ana, soy Uriel", stopReason: null }} />);
  expect(html).toContain("Toque 2 de 4 · WhatsApp");
  expect(html).toContain("Hola Ana, soy Uriel");
  expect(html).not.toContain(">default<");
});
```

- [ ] **Step 2: Correr y ver que falla** — Run: `npx vitest run src/components/leads.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implementar** `TodayRow`/`CadencePanel`; en Hoy y en la ficha cargar `loadCadence`; selector en el kanban; página de secuencias.

- [ ] **Step 4: Correr y revisar en el navegador** — Run: `npx vitest run src/components && npm run typecheck`; `npm run dev` → `http://localhost:3001/leads/secuencias`, `/leads/hoy`, una ficha. Expected: PASS; las tres pantallas cargan sin error.

- [ ] **Step 5: Commit**

```bash
git add src/components/leads.tsx src/components/leads.test.tsx "src/app/(app)/leads"
git commit -m "feat(cadencia): Hoy con toque N de M, panel de cadencia en la ficha, enrolar desde el kanban y lista de secuencias"
```

---

### Task 7: Enrolar al importar

**Files:**
- Modify: `src/domain/lead-sheet.ts` (`ImportLeadOptions.sequenceId`, `importLeadSheet` devuelve `enrolled`)
- Modify: `src/actions/contacts.ts` (`_importLeads` acepta `sequenceId: z.uuid().optional()`)
- Modify: `src/app/(app)/contacts/page.tsx` (Select "Enrolar en secuencia", placeholder "Sin secuencia")
- Test: `src/domain/sequences.integration.test.ts`

**Interfaces:**
- Consumes: `enroll`.
- Produces: `importLeadSheet(db, rows, { consentSource, ownerId, sequenceId })` → `{ created, completed, enrolled }`; enrola todos los contactos de la hoja (creados y completados) en `nuevo`/`contactado`; `enroll` omite el resto. Mensaje del action: `"… · N enrolado(s) en la secuencia"`.

- [ ] **Step 1: Prueba (roja)**

```ts
it("importar con secuencia enrola a los nuevos y a los que ya estaban en nuevo, no a los que ya pagaron")
  // 3 filas: nueva, existente nuevo, existente pago → enrolled 2.
```

- [ ] **Step 2: Correr y ver que falla** — Expected: FAIL, `enrolled` undefined.
- [ ] **Step 3: Implementar** (juntar los ids que devuelve `upsertContact` y llamar `enroll` una vez al final).
- [ ] **Step 4: Correr** — suite DB completa en verde.
- [ ] **Step 5: Commit**

```bash
git add src/domain/lead-sheet.ts src/actions/contacts.ts "src/app/(app)/contacts/page.tsx" src/domain/sequences.integration.test.ts
git commit -m "feat(cadencia): opción de enrolar en secuencia al importar la hoja"
```

---

### Task 8: Semilla "MTW 4 toques" y textos para aprobación

**Files:**
- Create: `docs/secuencia-mtw.md`
- Create: `dev/seed-secuencia-mtw.ts`
- Test: `dev/seed-secuencia-mtw.test.ts`

**Interfaces:**
- Produces: `export const MTW_SEQUENCE = { name: "MTW 4 toques", steps: Step[] }` con `Step = { position, dayOffset, channel, template?: { name, subject, html }, whatsappText? }`; 4 pasos: D0 correo (plantilla "MTW · Toque 1 · Nos vimos en Mexico Tech Week"), D3 WhatsApp, D7 correo (plantilla "MTW · Toque 3 · 15 minutos para enseñarte Ziora"), D14 WhatsApp. `seedMtwSequence(db): Promise<{ sequenceId: string; created: boolean }>` idempotente por `sequences.name` y `email_templates.name` (si existen, actualiza textos; no crea otra). CLI: `DATABASE_URL=… npx tsx dev/seed-secuencia-mtw.ts`.
- Reglas de los textos: tutear; el toque 1 menciona Mexico Tech Week (panel y taller de IA para terapeutas); usar `{{nombre}}` y `{{remitente}}`; cada correo incluye `<a href="{{{baja}}}">` y tiene menos de 120 palabras; cada WhatsApp menos de 60 palabras y sin HTML; el toque 4 cierra con elegancia ("no te vuelvo a escribir; aquí quedo").

- [ ] **Step 1: Prueba (roja)**

```ts
it("la semilla MTW tiene 4 pasos 0/3/7/14, correos con liga de baja y WhatsApp sin HTML ni más de 60 palabras", () => {
  expect(MTW_SEQUENCE.steps.map((s) => s.dayOffset)).toEqual([0, 3, 7, 14]);
  expect(MTW_SEQUENCE.steps.map((s) => s.channel)).toEqual(["email", "whatsapp", "email", "whatsapp"]);
  for (const s of MTW_SEQUENCE.steps) {
    if (s.channel === "email") { expect(s.template!.html).toContain("{{{baja}}}"); expect(templateVariables(s.template!.html)).toContain("nombre"); }
    else { expect(s.whatsappText).not.toMatch(/<[a-z]/i); expect(s.whatsappText!.split(/\s+/).length).toBeLessThanOrEqual(60); }
  }
});
```

- [ ] **Step 2: Correr y ver que falla** — Run: `npx vitest run dev/seed-secuencia-mtw.test.ts` — Expected: FAIL.
- [ ] **Step 3: Redactar los textos en `docs/secuencia-mtw.md`, implementar `MTW_SEQUENCE` y `seedMtwSequence`** (plantillas en `email_templates` por nombre; `createdBy` null; borrar y reinsertar los pasos de la secuencia al actualizar).
- [ ] **Step 4: Correr y sembrar local** — Run: `npx vitest run dev/seed-secuencia-mtw.test.ts && export $(grep -E "^DATABASE_URL" .env | tr -d '\r') && npx tsx dev/seed-secuencia-mtw.ts` → `created: true`; segunda corrida `created: false`. Verificar en `http://localhost:3001/leads/secuencias`.
- [ ] **Step 5: Commit**

```bash
git add docs/secuencia-mtw.md dev/seed-secuencia-mtw.ts dev/seed-secuencia-mtw.test.ts
git commit -m "feat(cadencia): secuencia semilla MTW 4 toques (textos pendientes de aprobación de Chris)"
```

---

### Task 9: Runbook, build y humo local

**Files:**
- Modify: `docs/RUNBOOK-CRM-LEADS.md` (nueva §7 "Fase 2 · Cadencia")
- Modify: `docs/SETUP-CONEXION.md` (scheduler `ziora-ops-run-sequences`)
- Modify: `README.md` (apartado Leads: secuencias y Hoy)

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Escribir §7** con: (a) orden tras el merge: migración 0014 (la corre `deploy.yml`) → `npx tsx dev/seed-secuencia-mtw.ts` contra prod **solo con la aprobación de Chris** → crear el scheduler:
  ```bash
  gcloud scheduler jobs create http ziora-ops-run-sequences --location $R --project $P \
    --schedule "0 8-19 * * *" --time-zone "America/Mexico_City" --http-method POST \
    --uri "$URL/api/jobs/run-sequences" \
    --headers "Authorization=Bearer $(gcloud secrets versions access latest --secret=ziora-ops-job-secret --project $P)"
  ```
  → enrolar desde el kanban por tandas (10 leads, revisar en Resend y en Hoy, luego el resto); (b) verificación: `curl -X POST -H "Authorization: Bearer …" $URL/api/jobs/run-sequences` devuelve conteos; (c) rollback: `gcloud scheduler jobs pause ziora-ops-run-sequences` y `update ops.sequence_enrollments set status='detenida', stop_reason='rollback' where status='activa'`; la migración no estorba al código anterior.
- [ ] **Step 2: Build y humo** — Run: matar dev server; `npm run build` — Expected: sin errores ni avisos nuevos. Luego `npm run dev`, enrolar un lead local desde la ficha y `curl -X POST -H "Authorization: Bearer $JOB_SECRET" http://localhost:3001/api/jobs/run-sequences` (sin `RESEND_API_KEY` el envío falla: debe quedar la actividad `sistema` "falló" con reintento en una hora y el job responde 200).
- [ ] **Step 3: Suite completa** — Run: `npx vitest run` y la suite con DB — Expected: todo verde; anotar conteos.
- [ ] **Step 4: Commit**

```bash
git add docs/RUNBOOK-CRM-LEADS.md docs/SETUP-CONEXION.md README.md
git commit -m "docs(cadencia): runbook de la fase 2 (scheduler, semilla, verificación, rollback)"
```
