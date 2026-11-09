# CRM de leads · Fase 0 (acceso + importación) y Fase 1 (lead core) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Ziora Ops pueda cargar los leads de Mexico Tech Week de forma segura y darles seguimiento con estado, dueño, próxima acción, historial, kanban y vista "Hoy".

**Architecture:** Se extiende `ops.contacts` con las columnas de lead y se agrega `ops.contact_activities` (timeline). Un módulo de dominio (`src/domain/leads.ts`) concentra las reglas de transición; las server actions, los webhooks y el job de sync lo llaman. Las vistas nuevas (`/leads`, `/leads/hoy`, `/leads/[id]`) reutilizan `Kanban`, `Modal`, `ActionForm` y el estilo de `/demos` y `/followups`.

**Tech Stack:** Next.js 15 (App Router, server actions), Drizzle ORM + Postgres 16 (schema `ops`), zod 4, Vitest, PGlite en local.

**Spec:** `docs/superpowers/specs/2026-11-10-crm-leads-design.md` (§4.1–4.3, 4.5–4.7, 4.10; §6 fases 0 y 1).

## Global Constraints

- Solo se toca el schema `ops.*`; nunca `public.*` (Event Ops). Migraciones idempotentes: `IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS` / `UPDATE ... WHERE ... IS NULL`.
- Estados de lead, exactamente: `nuevo | contactado | respondio | demo_agendada | en_trial | pago | perdido`. Orden: nuevo < contactado < respondio < demo_agendada < en_trial < pago. `perdido` es terminal y manual (exige `lost_reason`), salvo baja de correo → motivo `baja`.
- Un sync o webhook **solo avanza** el estado; nunca retrocede.
- Normalización de teléfono igual que `ziora-app/src/lib/whatsapp.ts`: longitud exacta por prefijo `{ "521": 13, "52": 12, "1": 11 }`; 10 dígitos → se antepone `52`; cualquier otra cosa → `null` (nunca bloquea).
- Permisos nuevos: `leads.view` (todos), `leads.manage` (sales, ceo, operations, clinical_director, marketing), `contacts.import` (sales, ceo, operations, marketing), `campaigns.send` (marketing, ceo, operations). Admin de Event Ops puede todo.
- Entra a Ops solo quien tiene fila en `ops.member_roles` o es admin.
- UI y mensajes en español; componentes de `src/components/ui`; `revalidatePath` tras cada acción como hacen las acciones existentes.
- Commits en español con prefijo convencional (`feat(leads): …`), terminando con `Claude-Session: https://claude.ai/code/session_01XR484AQFoFhRCpRNg2j1Bi`. Rama `feat/crm-leads`. No se hace push ni PR sin indicación de Chris.
- Pruebas unitarias de dominio sin base; las de base en `*.integration.test.ts` con `describe.runIf(RUN_DB_TESTS === "1")` como `contacts.integration.test.ts`. Comandos: `npm run typecheck`, `npm test`, y para base `RUN_DB_TESTS=1 npm run test:db` con PGlite corriendo (`npm run db:local`, `DB_POOL_MAX=1`).

## Review Focus

1. Teléfonos sucios ("+52 55 1234 5678", "5512345678", "(55) 1234-5678", "+1 332 600 3103", "123"): deben normalizar a `525512345678`, `525512345678`, `525512345678`, `13326003103` y `null` sin lanzar. → Task 1.
2. El cruce con `app_users` debe ignorar mayúsculas y espacios en el correo, y nunca bajar a quien ya está en `pago`. → Task 6.
3. Un webhook de demo `cancelled` de un lead que ya está `en_trial` no cambia el estado, solo agrega actividad. → Task 6.
4. Reimportar la misma hoja (con filas solo-teléfono) no crea duplicados ni pisa `lead_status`, dueño ni prioridad ya asignados. → Task 4.
5. Cerrar el acceso no debe sacar a un admin de Event Ops sin fila en `member_roles`, ni afectar webhooks y jobs; y un escáner que hace GET a la baja ya no da de baja. → Task 2.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/domain/phone.ts` (nuevo) | `normalizePhoneE164`, `waMessageLink` |
| `src/lib/permissions.ts` | matriz de permisos (+4) |
| `src/lib/session.ts` | `requireAccess` exige rol |
| `src/app/(auth)/login/page.tsx` | mensaje "sin rol" |
| `src/app/api/unsubscribe/route.ts` | GET confirma, POST da de baja |
| `src/actions/contacts.ts`, `src/actions/demos.ts`, `src/actions/campaigns.ts` | `requirePermission` en vez de `requireUser` |
| `src/components/sidebar.tsx` | permisos en Contactos/Demos/Correo masivo/Plantillas; entrada "Leads" |
| `src/db/schema.ts` | columnas de lead en `contacts`, enum `lead_status`, tabla `contact_activities` |
| `drizzle/0012_leads_columnas.sql`, `drizzle/0013_leads_backfill.sql` + `meta/_journal.json` | migraciones |
| `dev/duplicados-telefono.ts` (nuevo) | lista los teléfonos duplicados que la migración anuló |
| `src/domain/contacts.ts` | `upsertContact` busca por correo **o** teléfono; acepta campos de lead y consentimiento por canal |
| `src/domain/lead-sheet.ts` | filas solo-teléfono, columnas MTW |
| `src/domain/leads.ts` (nuevo) | reglas de estado, actividades, toques, dueño, próxima acción, timeline, convertir en cuenta, sync desde app_users, mensaje por defecto |
| `src/domain/demos.ts` | avance a `demo_agendada` |
| `src/actions/leads.ts` (nuevo) | server actions de leads |
| `src/components/leads.tsx` (nuevo) | `LeadCard`, `LeadStatusBadge`, `TouchButtons`, formularios, `TodayRow`, `Timeline` |
| `src/app/(app)/leads/page.tsx`, `leads/hoy/page.tsx`, `leads/[id]/page.tsx` (nuevos) | vistas |
| `src/components/my-day.tsx` | contador "Mis leads de hoy" |
| `src/lib/labels.ts` | `LEAD_STATUS`, `LEAD_PRIORITY`, `ACTIVITY_TYPE` |
| `src/app/api/jobs/sync-ziora-users/route.ts` | llama `syncLeadStatusFromAppUsers` |
| `docs/RUNBOOK-CRM-LEADS.md` (nuevo), `README.md`, `docs/SETUP-CONEXION.md` | despliegue fase 0/1 y apartados |

---

# FASE 0 — acceso e importación

### Task 1: Normalización de teléfono

**Files:**
- Create: `src/domain/phone.ts`
- Test: `src/domain/phone.test.ts`
- Modify: `src/lib/format.ts:33-37` (`waLink` usa la normalización)

**Interfaces:**
- Produces: `normalizePhoneE164(raw: string | null | undefined): string | null` (dígitos sin `+`, ej. `"525512345678"`); `waMessageLink(phoneE164: string | null, text: string): string` (con teléfono → `https://wa.me/<e164>?text=…`; sin teléfono → `https://wa.me/?text=…`).

- [ ] **Step 1: Prueba que falla**

```ts
import { describe, expect, it } from "vitest";
import { normalizePhoneE164, waMessageLink } from "./phone";

describe("normalizePhoneE164", () => {
  it.each([
    ["+52 55 1234 5678", "525512345678"],
    ["5512345678", "525512345678"],
    ["(55) 1234-5678", "525512345678"],
    ["52 1 55 1234 5678", "5215512345678"],
    ["+1 332 600 3103", "13326003103"],
    ["525512345678", "525512345678"],
  ])("%s → %s", (raw, e164) => expect(normalizePhoneE164(raw)).toBe(e164));
  it.each([["123"], [""], [null], [undefined], ["+52 55 1234"], ["5255123456789999"]])("%s → null", (raw) =>
    expect(normalizePhoneE164(raw as string | null | undefined)).toBeNull(),
  );
});

describe("waMessageLink", () => {
  it("con teléfono lleva destinatario; sin teléfono abre el selector de contacto", () => {
    expect(waMessageLink("525512345678", "Hola Ana")).toBe("https://wa.me/525512345678?text=Hola%20Ana");
    expect(waMessageLink(null, "Hola")).toBe("https://wa.me/?text=Hola");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**
Run: `npx vitest run src/domain/phone.test.ts` — Expected: FAIL, módulo no existe.

- [ ] **Step 3: Implementar `src/domain/phone.ts`**
Quitar todo lo que no sea dígito; si quedan 10 dígitos anteponer `52`; aceptar solo si la longitud coincide con `{ "521": 13, "52": 12, "1": 11 }` para su prefijo (probar primero `521`, luego `52`, luego `1`); si no, `null`.

- [ ] **Step 4: `waLink` en `src/lib/format.ts` delega en `normalizePhoneE164`** manteniendo la firma actual (`waLink(phone, text?)` → `null` si el teléfono no normaliza) para no romper `demos.tsx` y `followups/page.tsx`.

- [ ] **Step 5: Correr pruebas y typecheck**
Run: `npx vitest run src/domain/phone.test.ts && npm run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit** `feat(leads): normalización de teléfono E.164 y liga de WhatsApp`

---

### Task 2: Permisos nuevos y cierre de acceso

**Files:**
- Modify: `src/lib/permissions.ts` (PERMISSIONS)
- Modify: `src/lib/session.ts:29-33` (`requireAccess`)
- Modify: `src/app/(auth)/login/page.tsx` (mensaje por `error=SinRol`)
- Modify: `src/actions/contacts.ts` (5 `requireUser` → `requirePermission`), `src/actions/demos.ts` (`moveDemo`, `createDemo`, `updateDemo`, `syncDemosNow`, `demoFollowUpTask`), `src/actions/campaigns.ts` (crear/editar plantilla y campaña → `content.manage`; enviar campaña → `campaigns.send`)
- Modify: páginas `src/app/(app)/contacts/page.tsx`, `demos/page.tsx`, `campaigns/page.tsx`, `templates/page.tsx` (`requirePagePermission`) y `src/components/sidebar.tsx:30-47` (`perm`)
- Modify: `src/app/api/unsubscribe/route.ts`
- Test: `src/lib/permissions.test.ts` (existente, agregar casos), `src/app/api/unsubscribe/route.test.ts` (nuevo)

**Interfaces:**
- Produces: permisos `"leads.view" | "leads.manage" | "contacts.import" | "campaigns.send"` en `Permission`.

- [ ] **Step 1: Pruebas de permisos que fallan** (agregar a `permissions.test.ts`)

```ts
it("leads: todos ven; gestionan ventas, ceo, operaciones, director clínico y marketing", () => {
  for (const r of ALL_ROLES) expect(can({ isAdmin: false, roles: [r] }, "leads.view")).toBe(true);
  expect(can({ isAdmin: false, roles: ["marketing"] }, "leads.manage")).toBe(true);
  expect(can({ isAdmin: false, roles: ["dev_qa"] }, "leads.manage")).toBe(false);
  expect(can({ isAdmin: false, roles: ["dev_qa"] }, "contacts.import")).toBe(false);
  expect(can({ isAdmin: false, roles: ["sales"] }, "campaigns.send")).toBe(false);
  expect(can({ isAdmin: false, roles: ["marketing"] }, "campaigns.send")).toBe(true);
  expect(can({ isAdmin: true, roles: [] }, "leads.manage")).toBe(true);
});
```

- [ ] **Step 2: Correr y ver que falla** — `npx vitest run src/lib/permissions.test.ts`.

- [ ] **Step 3: Agregar los 4 permisos a `PERMISSIONS`** con los roles de Global Constraints. Correr: PASS.

- [ ] **Step 4: `requireAccess` exige rol**: si `!isAdmin && roles.length === 0` → `redirect("/login?error=SinRol")`. En `login/page.tsx`, con `error === "SinRol"` mostrar "Tu cuenta entra a Event Ops pero no tiene rol en Ziora Ops. Pídele a Uriel o Chris que te asigne uno en Ajustes → Equipo." (el `AccessDenied` existente se conserva).

- [ ] **Step 5: Cambiar `requireUser` por `requirePermission`** en las acciones listadas: contactos crear/editar/consentimiento → `leads.manage`; importar Event Ops y CSV → `contacts.import`; demos → `leads.manage`; plantillas y campañas crear/editar → `content.manage`; enviar campaña → `campaigns.send`. Páginas: `/contacts` y `/demos` → `requirePagePermission("leads.view")`; `/campaigns` y `/templates` → `requirePagePermission("content.manage")`; mismo `perm` en el sidebar.

- [ ] **Step 6: Prueba del unsubscribe que falla** (`src/app/api/unsubscribe/route.test.ts`): `vi.mock("@/db", () => ({ db: {} }))`, `vi.mock("@/domain/contacts", () => ({ optOut: vi.fn() }))`, `vi.mock("@/lib/crypto", () => ({ readUnsubscribeToken: () => "c-1" }))`, `process.env.UNSUBSCRIBE_SECRET = "x"`.

```ts
it("GET muestra confirmación y no da de baja", async () => {
  const res = await GET(new Request("https://ops.test/api/unsubscribe?t=abc"));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('method="post"');
  expect(optOut).not.toHaveBeenCalled();
});
it("POST da de baja", async () => {
  const res = await POST(new Request("https://ops.test/api/unsubscribe?t=abc", { method: "POST" }));
  expect(res.status).toBe(200);
  expect(optOut).toHaveBeenCalledWith(expect.anything(), "c-1");
});
```

- [ ] **Step 7: Implementar**: GET devuelve la misma página con un `<form method="post">` ("¿Quieres dejar de recibir estos correos?" + botón "Sí, darme de baja") y sin llamar `optOut`; POST da de baja (one-click RFC 8058 sigue siendo POST). Exportar `GET` y `POST` como funciones separadas.

- [ ] **Step 8: Correr todo** — `npm test && npm run typecheck` — PASS. Con `npm run dev` comprobar a mano que con `DEV_LOGIN_EMAIL` (admin del seed) se entra y `/contacts` carga.

- [ ] **Step 9: Commit** `feat(acceso): entrar exige rol en Ops; permisos de leads, importación y envío; baja por POST`

---

### Task 3: Migración 0012 — columnas de lead, timeline y teléfono E.164

**Files:**
- Modify: `src/db/schema.ts` (contacts; nuevo enum y tabla), `src/lib/labels.ts`
- Create: `drizzle/0012_leads_columnas.sql`; Modify: `drizzle/meta/_journal.json` (entrada idx 12) y snapshot generado
- Create: `dev/duplicados-telefono.ts`
- Test: `src/domain/phone.integration.test.ts`

**Interfaces:**
- Produces en `schema.ts`: `leadStatusEnum = ops.enum("lead_status", ["nuevo","contactado","respondio","demo_agendada","en_trial","pago","perdido"])`; `contacts` + `leadStatus`, `lostReason`, `statusChangedAt`, `ownerId` (→ `users.id`, set null), `nextAction`, `nextActionOn` (date), `lastContactAt`, `priority` (integer), `segment` (text), `phoneE164` (text; `uniqueIndex("contacts_phone_e164_unique").on(t.phoneE164).where(sql\`${t.phoneE164} is not null\`)`); índices `contacts_lead_status_idx`, `contacts_owner_idx`, `contacts_next_action_idx`.
- `activityTypeEnum = ops.enum("activity_type", ["nota","whatsapp","correo","llamada","reunion","cambio_estado","demo","campana","secuencia","sistema"])`; `activityDirectionEnum = ops.enum("activity_direction", ["saliente","entrante","ninguna"])`; `contactActivities = ops.table("contact_activities", { id: id(), contactId (cascade), type, direction (default "ninguna"), actorId (→ users.id, set null), actorLabel: text notNull, occurredAt (default now), summary: text notNull, meta: jsonb default '{}' }, índice (contactId, occurredAt))`.
- Tipos exportados: `LeadStatus`, `ActivityType`.
- `labels.ts`: `LEAD_STATUS` (nuevo: "Nuevo", contactado: "Contactado", respondio: "Respondió", demo_agendada: "Demo agendada", en_trial: "En trial", pago: "Pagó", perdido: "Perdido"), `LEAD_PRIORITY` ({1: "HOT", 2: "WARM", 3: "COLD"}), `ACTIVITY_TYPE` (nota: "Nota", whatsapp: "WhatsApp", correo: "Correo", llamada: "Llamada", reunion: "Reunión", cambio_estado: "Cambio de estado", demo: "Demo", campana: "Campaña", secuencia: "Secuencia", sistema: "Sistema").

- [ ] **Step 1: Editar `schema.ts` y `labels.ts`** con lo anterior (seguir el estilo de `demoRequests`).

- [ ] **Step 2: Generar y adaptar la migración**
Run: `npm run db:generate` → renombrar el SQL a `0012_leads_columnas.sql` (ajustar `tag` en `_journal.json`) y reescribirlo idempotente: `CREATE TYPE` dentro de `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`, `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, FKs en `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...')`. Al final de la migración, **antes** del índice único, agregar el backfill de teléfono:
  1. `CREATE OR REPLACE FUNCTION ops.normalize_phone_e164(raw text) RETURNS text IMMUTABLE LANGUAGE sql` con las mismas reglas que `normalizePhoneE164` (quitar no-dígitos con `regexp_replace(raw, '\D', '', 'g')`; 10 dígitos → `'52' || d`; aceptar solo `521`+13, `52`+12 o `1`+11; si no, `NULL`).
  2. `UPDATE ops.contacts SET phone_e164 = ops.normalize_phone_e164(phone) WHERE phone_e164 IS NULL AND phone IS NOT NULL;`
  3. Duplicados: con `row_number() OVER (PARTITION BY phone_e164 ORDER BY created_at, id)`, los que no son el primero quedan con `phone_e164 = NULL` y `details = details || jsonb_build_object('telefono_duplicado_de', <id del primero>)`.
  4. `CREATE UNIQUE INDEX IF NOT EXISTS contacts_phone_e164_unique ON ops.contacts (phone_e164) WHERE phone_e164 IS NOT NULL;`

- [ ] **Step 3: Aplicar en local dos veces**
Run: `npm run db:migrate && npm run db:migrate` — Expected: ambas sin error. Comprobar: `npx tsx dev/sql.ts "select column_name from information_schema.columns where table_schema='ops' and table_name='contacts' and column_name in ('lead_status','phone_e164','owner_id')"` devuelve 3 filas.

- [ ] **Step 4: Prueba de paridad SQL ↔ TS que falla** (`src/domain/phone.integration.test.ts`, `describe.runIf(RUN_DB_TESTS)`): para cada caso de la tabla de Task 1 (los seis válidos y los seis nulos), `select ops.normalize_phone_e164(${raw})` devuelve lo mismo que `normalizePhoneE164(raw)`. Correr: PASS (si falla, se corrige la función SQL, nunca la TS).

- [ ] **Step 5: Script `dev/duplicados-telefono.ts`** (solo lectura): lista los contactos con `details->>'telefono_duplicado_de'` junto con el contacto que conservó el número (id, nombre, correo, teléfono de ambos) para que Uriel los fusione a mano. Se corre con `npx tsx dev/duplicados-telefono.ts`. Probar contra el seed: termina sin error e imprime `duplicados: N`.

- [ ] **Step 6: Typecheck y pruebas** — `npm run typecheck && npm test` — PASS.

- [ ] **Step 7: Commit** `feat(leads): columnas de lead, timeline contact_activities y teléfono E.164 con backfill (migración 0012)`

---

### Task 4: Importación con teléfono, columnas MTW y consentimiento por canal

**Files:**
- Modify: `src/domain/contacts.ts` (`UpsertInput`, `upsertContact`)
- Modify: `src/domain/lead-sheet.ts` (`LeadRow`, `parseLeadSheet`, `leadTags`, `importLeadSheet`)
- Modify: `src/actions/contacts.ts` (`_importLeads`), `src/app/(app)/contacts/page.tsx` (modal de importación)
- Test: `src/domain/lead-sheet.test.ts`, `src/domain/contacts.integration.test.ts`

**Interfaces:**
- `UpsertInput` gana: `phoneE164?: string | null` (si no viene, se calcula de `phone`), `leadStatus?: LeadStatus | null`, `priority?: number | null`, `segment?: string | null`, `ownerId?: string | null`, `consents?: { channel: "email" | "whatsapp"; source: string; evidence?: string }[]`. `email` pasa a `string | null | undefined`. Búsqueda: por `email` normalizado si hay; si no, por `phoneE164`. En contacto existente, `fill` también para los campos nuevos (nunca pisa `leadStatus`, `ownerId`, `priority`, `segment` ya puestos). `marketingOptIn` se conserva como azúcar de `consents: [{ channel: "email", ... }]`.
- `LeadRow`: `email?: string`, `phone?: string`, `phoneE164?: string`, `priority?: number`, `segment?: string`, `b2bFlag?: string`, `eventos?: { panel?: boolean; taller?: boolean; ticketPanel?: string }`. Alias nuevos en `ALIASES`: `prioridad`, `segmento`, `flag-b2b`, `asistio-panel`, `asistio-taller`, `ticket-panel`.
- `importLeadSheet(db, rows, opts?: { ownerId?: string | null; consentSource?: "evento_luma" | null })` → `{ created, completed }`.

- [ ] **Step 1: Pruebas unitarias que fallan** (en `lead-sheet.test.ts` reemplazar las expectativas de "sin correo" y de columnas ignoradas)

```ts
it("acepta filas solo con teléfono", () => {
  const sinCorreo = r.rows.find((x) => x.name === "Sin Correo");
  expect(sinCorreo).toMatchObject({ email: undefined, phoneE164: "525500000004" });
  expect(r.skipped).toEqual([{ line: 6, reason: "correo repetido en la hoja (ana.prueba@example.com)" }]);
});
it("lee prioridad, segmento, flag B2B y asistencia", () => {
  expect(r.rows[0]).toMatchObject({ priority: 1, segment: "HOT", eventos: { panel: true, taller: true, ticketPanel: "Presencial" } });
  expect(r.rows[1]).toMatchObject({ priority: 2, segment: "COLD", b2bFlag: "Director", eventos: { panel: false, taller: false, ticketPanel: "Virtual" } });
  expect(r.ignoredColumns).toEqual(["Registrado Panel", "Registrado Taller"]);
});
it("deduplica por teléfono y salta filas sin correo ni teléfono válido", () => {
  const x = parseLeadSheet("Nombre,Email,Teléfono\nUno,,5512345678\nDos,,+52 55 1234 5678\nNadie,,12\n");
  expect(x.rows).toHaveLength(1);
  expect(x.skipped).toEqual([
    { line: 3, reason: "teléfono repetido en la hoja (525512345678)" },
    { line: 4, reason: "sin correo ni teléfono válido" },
  ]);
});
```
(`segment` guarda el texto sin emoji ni espacios extra: "🔥 HOT" → "HOT", "💻 COLD-Virtual" → "COLD-Virtual". `b2bFlag` igual: "⭐ Director" → "Director".)

- [ ] **Step 2: Correr y ver que falla** — `npx vitest run src/domain/lead-sheet.test.ts`.

- [ ] **Step 3: Implementar en `lead-sheet.ts`**: parseo de columnas nuevas, `phoneE164` con `normalizePhoneE164`, dedupe en archivo por correo y por `phoneE164`, `leadTags` agrega `clinic` también si `b2bFlag` contiene "director". `importLeadSheet` pasa a `upsertContact`: `leadStatus: "nuevo"`, `priority`, `segment`, `ownerId: opts.ownerId`, `details: { eventos, flagB2B }`, y `consents` email+whatsapp cuando `opts.consentSource === "evento_luma"` (evidencia: "Registro en Luma · Mexico Tech Week 2026 (panel 26-oct / taller 30-oct)").

- [ ] **Step 4: Implementar en `contacts.ts`** la búsqueda por correo o teléfono y los campos nuevos; `consents` hace upsert en `contactConsents` por canal con la regla existente "una baja previa gana". Correr unitarias: PASS. `npm run typecheck`: PASS (ajustar llamadas existentes de `upsertContact` si cambió el tipo de `email`).

- [ ] **Step 5: Prueba de integración que falla** (agregar a `contacts.integration.test.ts`)

```ts
it("importa solo-teléfono, deduplica por teléfono y no pisa estado ni dueño al reimportar", async () => {
  const t = Date.now().toString().slice(-8);
  const csv = `Prioridad,Segmento,Nombre,Email,Teléfono\n2,🟠 WARM-A,Tel Uno,,55${t}\n`;
  const { rows } = parseLeadSheet(csv);
  const r1 = await importLeadSheet(db, rows, { consentSource: "evento_luma" });
  expect(r1).toEqual({ created: 1, completed: 0 });
  const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, `5255${t}`));
  expect(c).toMatchObject({ email: null, leadStatus: "nuevo", priority: 2, segment: "WARM-A" });
  const cons = await db.select().from(contactConsents).where(eq(contactConsents.contactId, c.id));
  expect(cons.map((x) => [x.channel, x.optIn, x.source]).sort()).toEqual([["email", true, "evento_luma"], ["whatsapp", true, "evento_luma"]]);
  await db.update(contacts).set({ leadStatus: "contactado", priority: 1 }).where(eq(contacts.id, c.id));
  const r2 = await importLeadSheet(db, parseLeadSheet(csv.replace("55" + t, "+52 55 " + t)).rows, { consentSource: "evento_luma" });
  expect(r2).toEqual({ created: 0, completed: 1 });
  const [again] = await db.select().from(contacts).where(eq(contacts.id, c.id));
  expect(again).toMatchObject({ leadStatus: "contactado", priority: 1 });
});
```

- [ ] **Step 6: Correr integración** — con PGlite arriba: `RUN_DB_TESTS=1 npx vitest run src/domain/contacts.integration.test.ts --no-file-parallelism` — PASS.

- [ ] **Step 7: Formulario de importación** (`contacts/page.tsx` modal + `_importLeads`): agregar `Select name="consentSource"` (opciones `[["evento_luma", "Registro en Luma (Mexico Tech Week)"]]`, placeholder "Sin base de consentimiento") y `Select name="ownerId"` (opciones `userOptions(await listUsers())`, placeholder "Sin dueño"). El mensaje final incluye cuántas filas entraron solo con teléfono. Importar exige `contacts.import` (Task 2).

- [ ] **Step 8: Typecheck + pruebas + humo** — `npm run typecheck && npm test`; en el navegador importar un CSV de 3 filas (una solo con teléfono) y ver los 3 contactos en `/contacts`.

- [ ] **Step 9: Commit** `feat(leads): importar la hoja MTW con teléfono, prioridad, segmento y consentimiento por canal`

---

# FASE 1 — lead core

### Task 5: Dominio de leads — estados, actividades, toques

**Files:**
- Create: `src/domain/leads.ts`
- Test: `src/domain/leads.test.ts` (puro), `src/domain/leads.integration.test.ts`

**Interfaces (Produces):**
```ts
export const LEAD_ORDER: LeadStatus[] = ["nuevo","contactado","respondio","demo_agendada","en_trial","pago"];
export function isForward(from: LeadStatus | null, to: LeadStatus): boolean; // true si `to` está después de `from` en LEAD_ORDER (from null cuenta como antes de nuevo); perdido nunca es forward
export type Actor = { userId: string | null; label: string }; // label: nombre de la persona, "sistema" o "token:<nombre>"
export async function logActivity(db: Db, a: { contactId: string; type: ActivityType; direction?: "saliente"|"entrante"|"ninguna"; actor: Actor; summary: string; meta?: Record<string, unknown>; occurredAt?: Date }): Promise<string>;
export async function advanceLead(db: Db, contactId: string, to: LeadStatus, actor: Actor, meta?: Record<string, unknown>): Promise<boolean>; // solo si isForward; escribe cambio_estado; devuelve si cambió
export async function setLeadStatus(db: Db, contactId: string, to: LeadStatus, actor: Actor, opts?: { lostReason?: string }): Promise<void>; // manual, cualquier dirección; perdido sin lostReason → Error("Indica el motivo")
export async function recordTouch(db: Db, contactId: string, channel: "whatsapp"|"correo"|"llamada"|"reunion", actor: Actor, summary: string): Promise<void>; // actividad saliente + lastContactAt=now + advanceLead(contactado)
export async function markReplied(db: Db, contactId: string, actor: Actor, summary?: string): Promise<void>; // actividad entrante (tipo "nota" si no hay canal) + advanceLead(respondio)
export async function assignOwner(db: Db, contactIds: string[], ownerId: string | null, actor: Actor): Promise<void>; // actividad sistema "Asignado a <nombre>" por contacto
export async function setNextAction(db: Db, contactId: string, next: { text: string | null; on: string | null }, actor: Actor): Promise<void>;
export async function setPriority(db: Db, contactIds: string[], priority: 1|2|3|null, actor: Actor): Promise<void>;
```

- [ ] **Step 1: Pruebas puras que fallan** (`leads.test.ts`)

```ts
describe("isForward", () => {
  it("avanza solo hacia adelante", () => {
    expect(isForward(null, "nuevo")).toBe(true);
    expect(isForward("nuevo", "contactado")).toBe(true);
    expect(isForward("contactado", "pago")).toBe(true);
    expect(isForward("pago", "en_trial")).toBe(false);
    expect(isForward("respondio", "respondio")).toBe(false);
    expect(isForward("nuevo", "perdido")).toBe(false);
    expect(isForward("perdido", "contactado")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**; implementar `LEAD_ORDER` e `isForward`; PASS.

- [ ] **Step 3: Pruebas de integración que fallan** (`leads.integration.test.ts`, mismo patrón `describe.runIf`)

```ts
it("un toque pasa nuevo→contactado y deja actividad; un avance no retrocede; perdido exige motivo", async () => {
  const { id } = await upsertContact(db, { name: "Lead Prueba", email: `lead${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
  const actor = { userId: null, label: "prueba" };
  await recordTouch(db, id, "whatsapp", actor, "Primer mensaje");
  let [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  expect(c.leadStatus).toBe("contactado"); expect(c.lastContactAt).not.toBeNull();
  expect(await advanceLead(db, id, "pago", actor)).toBe(true);
  expect(await advanceLead(db, id, "en_trial", actor)).toBe(false);
  [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  expect(c.leadStatus).toBe("pago");
  await expect(setLeadStatus(db, id, "perdido", actor)).rejects.toThrow("Indica el motivo");
  await setLeadStatus(db, id, "perdido", actor, { lostReason: "No le interesa" });
  const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
  expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(["whatsapp", "cambio_estado"]));
  expect(acts.filter((a) => a.type === "cambio_estado")).toHaveLength(3); // contactado, pago, perdido
});
```

- [ ] **Step 4: Implementar** las funciones en `leads.ts` (transacción por operación; `statusChangedAt = now` en cada cambio; `cambio_estado` con `summary` "Nuevo → Contactado" usando `LEAD_STATUS` y `meta: { from, to, lostReason? }`).

- [ ] **Step 5: Correr integración** — PASS. `npm run typecheck`.

- [ ] **Step 6: Commit** `feat(leads): dominio de estados, actividades y toques`

---

### Task 6: Avance automático desde demos y usuarios de la app

**Files:**
- Modify: `src/domain/demos.ts` (`ingestDemo`, `applyWebhookDemo`), `src/actions/demos.ts:66-72` (`moveDemo`)
- Modify: `src/domain/leads.ts` (+ `syncLeadStatusFromAppUsers`)
- Modify: `src/app/api/jobs/sync-ziora-users/route.ts`
- Test: `src/domain/leads.integration.test.ts`

**Interfaces:**
- Produces: `syncLeadStatusFromAppUsers(db: Db, now?: Date): Promise<{ trial: number; paid: number }>` — cruza `app_users` (no removidos, no test) con `contacts` por `lower(trim(email))`; `status === "trialing"` → `advanceLead(en_trial)`; `status === "active" && mrrCents > 0` → `advanceLead(pago)`; actor `{ userId: null, label: "sistema" }`, meta `{ source: "app_users", uid }`; cuenta solo los que cambiaron.
- `ingestDemo`/`applyWebhookDemo`: tras crear/reagendar con `scheduledAt` → `advanceLead(contactId, "demo_agendada")` + `logActivity` tipo `demo` ("Demo agendada para <fecha>"); `cancelled` → solo actividad `demo` ("Canceló la demo"). `moveDemo`: `trial` → `advanceLead(en_trial)`, `paid` → `advanceLead(pago)`, `lost`/`no_show` → actividad `demo` sin cambio de estado. Actor en acciones: `{ userId: user.id, label: user.name }`; en webhook: sistema.
- `optOut` / `optOutByEmail` en `src/domain/contacts.ts` (baja por cualquier canal, §4.10): además de revocar el consentimiento, si el contacto tiene `leadStatus` y no está en `en_trial`/`pago`/`perdido` → `setLeadStatus(perdido, { lostReason: "baja" })` con actor sistema. (Mi decisión: a quien ya paga o está en trial no se le marca perdido por darse de baja del marketing; solo se registra la actividad `sistema` "Baja de <canal>".)

- [ ] **Step 1: Pruebas de integración que fallan**

```ts
it("demo agendada avanza al lead y cancelar no lo retrocede", async () => {
  const email = `demo${t}@example.com`;
  await applyWebhookDemo(db, { externalId: `x${t}`, fullName: "Demo Lead", email, scheduledAt: new Date(Date.now() + 86400000), source: "test" });
  let [c] = await db.select().from(contacts).where(eq(contacts.email, email));
  expect(c.leadStatus).toBe("demo_agendada");
  await advanceLead(db, c.id, "en_trial", { userId: null, label: "prueba" });
  await applyWebhookDemo(db, { externalId: `x${t}`, fullName: "Demo Lead", email, source: "test", status: "cancelled" });
  [c] = await db.select().from(contacts).where(eq(contacts.email, email));
  expect(c.leadStatus).toBe("en_trial");
});
it("el sync de usuarios sube a en_trial y pago sin importar mayúsculas y nunca baja", async () => {
  const email = `app${t}@example.com`;
  const { id } = await upsertContact(db, { name: "App Lead", email: ` ${email.toUpperCase()} `, source: "manual", tags: ["lead"], leadStatus: "contactado" });
  await db.insert(appUsers).values({ uid: `u${t}`, email, plan: "pro", status: "trialing", syncedAt: new Date() });
  expect(await syncLeadStatusFromAppUsers(db)).toEqual({ trial: 1, paid: 0 });
  await db.update(appUsers).set({ status: "active", mrrCents: 69900 }).where(eq(appUsers.uid, `u${t}`));
  expect(await syncLeadStatusFromAppUsers(db)).toEqual({ trial: 0, paid: 1 });
  await db.update(appUsers).set({ status: "trialing", mrrCents: null }).where(eq(appUsers.uid, `u${t}`));
  expect(await syncLeadStatusFromAppUsers(db)).toEqual({ trial: 0, paid: 0 });
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  expect(c.leadStatus).toBe("pago");
});
it("la baja de correo marca perdido:baja salvo a quien ya está en trial o pagando", async () => {
  const a = await upsertContact(db, { name: "Baja A", email: `bajaa${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "contactado" });
  const b = await upsertContact(db, { name: "Baja B", email: `bajab${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "pago" });
  await optOut(db, a.id); await optOut(db, b.id);
  const [ca] = await db.select().from(contacts).where(eq(contacts.id, a.id));
  const [cb] = await db.select().from(contacts).where(eq(contacts.id, b.id));
  expect(ca).toMatchObject({ leadStatus: "perdido", lostReason: "baja" });
  expect(cb.leadStatus).toBe("pago");
});
```

- [ ] **Step 2: Correr y ver que falla.**

- [ ] **Step 3: Implementar** en `demos.ts`, `actions/demos.ts`, `contacts.ts` (`optOut`) y `leads.ts`; en la ruta `sync-ziora-users` llamar `syncLeadStatusFromAppUsers(db)` después de `applySnapshot` y devolver `leads: { trial, paid }` en el JSON. Ojo con el import circular `contacts.ts` ↔ `leads.ts`: `leads.ts` importa de `contacts.ts` solo tipos; la llamada de `optOut` a `setLeadStatus` se hace con `import` normal porque `leads.ts` no importa funciones de `contacts.ts` (si hiciera falta, mover `setLeadStatus` a `src/domain/lead-status.ts`).

- [ ] **Step 4: Correr integración y unitarias** — PASS. `npm run typecheck`.

- [ ] **Step 5: Commit** `feat(leads): el estado avanza solo con demo agendada y con trial/pago de la app`

---

### Task 7: Migración 0013 — backfill de estado inicial

**Files:**
- Create: `drizzle/0013_leads_backfill.sql`; Modify: `drizzle/meta/_journal.json` (idx 13; sin snapshot nuevo porque no cambia el schema)

- [ ] **Step 1: Escribir SQL idempotente** (todo con `WHERE lead_status IS NULL` o condición "solo hacia adelante" vía CTE que asigna orden numérico 0..5 a los estados), en este orden:
  1. `UPDATE ops.contacts c SET lead_status='nuevo', status_changed_at=now() WHERE lead_status IS NULL AND EXISTS (SELECT 1 FROM ops.contact_tags t WHERE t.contact_id=c.id AND t.tag='lead');`
  2. Desde `ops.app_users` (sin `removed_at`, `is_test = false`) por `lower(trim(email))`: `trialing` → `en_trial`; `active` con `mrr_cents > 0` → `pago`. Solo hacia adelante.
  3. Desde `ops.demo_requests` (la demo más reciente por `contact_id`): `scheduled`/`done` → `demo_agendada`; `trial` → `en_trial`; `paid` → `pago`; `lost`/`no_show` → `perdido` con `lost_reason = coalesce(demo.lost_reason, 'Demo perdida')` **solo si** el estado actual es `nuevo`/`contactado`/`respondio` (quien ya está en trial o pagando por la app no se marca perdido); `requested` → sin cambio. Lo demás solo hacia adelante.
  4. Insertar en `ops.contact_activities` (`type='sistema'`, `actor_label='sistema'`, `summary='Estado inicial por backfill: <estado>'`, `meta='{"backfill":"0013"}'`) por contacto con `lead_status` no nulo que aún no tenga actividad con `meta->>'backfill'='0013'`.

- [ ] **Step 2: Aplicar dos veces en local** — `npm run db:migrate && npm run db:migrate` — sin errores; `npx tsx dev/sql.ts "select lead_status, count(*) from ops.contacts group by 1"` muestra leads repartidos (el seed tiene demos en trial/paid).

- [ ] **Step 3: Commit** `feat(leads): backfill de estado inicial desde etiquetas, demos y usuarios de la app (migración 0013)`

---

### Task 8: Server actions de leads

**Files:**
- Create: `src/actions/leads.ts`
- Test: ninguna propia (envoltorios finos; el dominio ya está probado). Typecheck obligatorio.

**Interfaces (Produces, `"use server"`, cada una con `requirePermission("leads.manage")` y `actor = { userId: user.id, label: user.name }`):**
```ts
export async function moveLead(id: string, status: string): Promise<void>; // kanban; si status === "perdido" lanza Error("Usa el botón Perdido para indicar el motivo"); si no, setLeadStatus
export async function setLeadStatusAction(prev: ActionState, fd: FormData): Promise<ActionState>; // id, status, lostReason?
export async function recordTouchAction(prev: ActionState, fd: FormData): Promise<ActionState>; // id, channel, summary? (por defecto "Mensaje enviado por <canal>")
export async function markRepliedAction(prev: ActionState, fd: FormData): Promise<ActionState>; // id, summary?
export async function setNextActionAction(prev: ActionState, fd: FormData): Promise<ActionState>; // id, text?, on? (YYYY-MM-DD)
export async function postponeAction(prev: ActionState, fd: FormData): Promise<ActionState>; // id, days (1|3|7) → nextActionOn = hoy (todayISO) + days; sin actividad (posponer no es toque)
export async function assignOwnerAction(prev: ActionState, fd: FormData): Promise<ActionState>; // ids[], ownerId?
export async function setPriorityAction(prev: ActionState, fd: FormData): Promise<ActionState>; // ids[], priority?
export async function addNoteAction(prev: ActionState, fd: FormData): Promise<ActionState>; // id, text → logActivity nota
export async function convertToAccountAction(prev: ActionState, fd: FormData): Promise<ActionState>; // id (Task 12)
```
Patrón: `formAction(z.object({...}), async (d) => { const { user } = await requirePermission("leads.manage"); …; revalidatePath("/leads", "layout"); revalidatePath("/contacts"); return "…"; })` + wrappers `export async function` como en `actions/contacts.ts`.

- [ ] **Step 1: Implementar** siguiendo `src/actions/contacts.ts` y `src/actions/demos.ts` (dejar `convertToAccountAction` llamando a `convertLeadToAccount` que se crea en Task 12; hasta entonces, lanzar `Error("Pendiente")`).
- [ ] **Step 2: `npm run typecheck`** — PASS.
- [ ] **Step 3: Commit** `feat(leads): server actions de estado, toques, dueño, prioridad y notas`

---

### Task 9: Página /leads (kanban) y entrada en el menú

**Files:**
- Create: `src/app/(app)/leads/page.tsx`, `src/components/leads.tsx`
- Modify: `src/components/sidebar.tsx:30-34` (`{ href: "/leads", label: "Leads", icon: Funnel, count: counts.leads, perm: "leads.view" }` antes de Demos), `src/db/queries.ts` (`navCounts` + `leads`: leads no terminales con `nextActionOn <= hoy`, sin filtrar por dueño porque `navCounts` no conoce al usuario; dejar comentario)

**Interfaces:**
- `LeadCard({ c, owner }: { c: typeof contacts.$inferSelect; owner?: string | null })` (client, en `leads.tsx`): nombre, `LeadPriorityBadge` (1 → `Badge tone="red"` HOT, 2 → ámbar WARM, 3 → gris COLD), `jobTitle`, ciudad, `segment`, dueño (`Avatar`), próxima acción con fecha (en rojo si `nextActionOn < hoy`), `Link` a `/leads/[id]`.
- Columnas del kanban: `LEAD_ORDER.map(s => ({ id: s, label: LEAD_STATUS[s] }))` + `{ id: "perdido", label: "Perdido", accent: "bg-faint" }`; `onMove={moveLead}`.
- Filtros por `searchParams`: `todos=1` (quita "Solo los míos"; por defecto se muestran los leads del usuario en sesión más los sin dueño), `prioridad`, `origen`, `etiqueta`, `ciudad`, `q` (nombre, correo o empresa).
- KPIs arriba (mismo patrón de tarjetas que `/contacts`): total leads, pendientes hoy, respondieron últimos 7 días, en trial, pagaron.
- Selección múltiple: casilla `ids[]` en cada tarjeta + `SelectAll` existente + barra con `assignOwnerAction` (select de usuarios) y `setPriorityAction`.

- [ ] **Step 1: Implementar la página** siguiendo `demos/page.tsx` (`requirePagePermission("leads.view")`, `export const dynamic = "force-dynamic"`, `Kanban` con los contactos con `leadStatus` no nulo). El kanban es de solo lectura visual si el usuario no tiene `leads.manage` (pasar `onMove` que lanza "Tu rol no tiene permiso").
- [ ] **Step 2: Humo en el navegador**: `/leads` muestra columnas con contactos del seed; arrastrar de "Nuevo" a "Contactado" persiste tras recargar y crea actividad (`npx tsx dev/sql.ts "select type, summary from ops.contact_activities order by occurred_at desc limit 3"`). Arrastrar a "Perdido" muestra el error.
- [ ] **Step 3: `npm run typecheck && npm test`** — PASS.
- [ ] **Step 4: Commit** `feat(leads): kanban de leads con filtros, selección múltiple y entrada en el menú`

---

### Task 10: Ficha del lead con timeline

**Files:**
- Modify: `src/domain/leads.ts` (+ `loadTimeline`)
- Create: `src/app/(app)/leads/[id]/page.tsx`
- Modify: `src/components/leads.tsx` (`LeadStatusForm`, `TouchButtons`, `NextActionForm`, `NoteForm`, `Timeline`)
- Modify: `src/app/(app)/contacts/page.tsx` (en el modal del contacto, link "Ver ficha de lead" cuando `leadStatus` no es nulo)
- Test: `src/domain/leads.integration.test.ts`

**Interfaces:**
- `loadTimeline(db: Db, contactId: string): Promise<TimelineItem[]>`; `TimelineItem = { at: Date; kind: ActivityType | "campaign_send" | "demo"; title: string; detail?: string; actor?: string }`: unión ordenada desc de `contact_activities`, `campaign_sends` del contacto ("Correo de campaña · <estado>") y `demo_requests` del contacto ("Demo · <DEMO_STAGE>", detalle fecha agendada).
- Ficha: encabezado (nombre, `LeadStatusBadge`, prioridad, dueño, origen, segmento); datos de contacto con botón WhatsApp (`waMessageLink(c.phoneE164, defaultMessage(c, user.name))`, Task 11) y `mailto:`; perfil (pacientes/sem, enfoque, documentación, usa IA); consentimientos por canal; "Siguiente paso" (`NextActionForm`: texto + fecha); `TouchButtons` ("Mandé WhatsApp", "Mandé correo", "Llamé", "Respondió"); `LeadStatusForm` (select de estado + campo motivo visible si perdido); `NoteForm`; botón "Convertir en cuenta" (Task 12); `Timeline`.

- [ ] **Step 1: Prueba de integración que falla**: tras `recordTouch` y una fila en `demo_requests` para el contacto, `loadTimeline` devuelve ≥ 2 elementos ordenados desc por `at` y el primero es el toque (`kind: "whatsapp"`).
- [ ] **Step 2: Implementar `loadTimeline`**; correr: PASS.
- [ ] **Step 3: Implementar la página y los componentes** (server page + client forms con `ActionForm`/`Submit`; los `TouchButtons` son un `ActionForm` por botón con `input hidden` de `id` y `channel`).
- [ ] **Step 4: Humo**: desde `/leads` abrir una ficha; "Mandé WhatsApp" registra el toque, el estado pasa a Contactado y el timeline lo muestra; "Perdido" sin motivo muestra error; con motivo cambia.
- [ ] **Step 5: `npm run typecheck && npm test`** y `RUN_DB_TESTS=1 npm run test:db` — PASS.
- [ ] **Step 6: Commit** `feat(leads): ficha del lead con timeline, toques, siguiente paso y notas`

---

### Task 11: Vista Hoy, mensaje por defecto y contador en el dashboard

**Files:**
- Modify: `src/domain/leads.ts` (+ `defaultMessage`)
- Create: `src/app/(app)/leads/hoy/page.tsx`
- Modify: `src/components/leads.tsx` (`TodayRow`), `src/components/my-day.tsx`
- Test: `src/domain/leads.test.ts`

**Interfaces:**
- `defaultMessage(c: { name: string; leadStatus: LeadStatus | null }, userName: string): string` — por estado: `nuevo`/`contactado` → saludo con el primer nombre, "soy <userName> de Ziora", referencia a Mexico Tech Week y una pregunta de cierre; `respondio` → propuesta de 15 min esta semana; `demo_agendada` → confirmación de la demo; resto → saludo breve. Sin datos clínicos ni precios.
- Página `/leads/hoy`: `requirePagePermission("leads.view")`; `mineOnly = sp.todos !== "1"`; secciones "Hoy y atrasados" (`nextActionOn <= today`, vencidos primero y luego prioridad), "Próximos 7 días", "Sin próxima acción" (leads `nuevo`/`contactado`/`respondio` del dueño sin fecha). `TodayRow`: nombre + prioridad + estado, `nextAction`, mensaje en `<textarea readOnly>` con `CopyButton`, botón WhatsApp (`waMessageLink`, `target="_blank"`), "Ya lo mandé" (`recordTouchAction` whatsapp), "Mandé correo", "Respondió", "Posponer 1 / 3 / 7 días" (`postponeAction`), "Perdido" (modal con motivo).
- `MyDay`: cuando `can(access, "leads.view")`, item `{ label: "Mis leads de hoy", n, href: "/leads/hoy", urgent }` con `n = count(contacts) where ownerId = user.id and nextActionOn <= today and leadStatus not in ('pago','perdido')` y `urgent` si hay alguno con `nextActionOn < today`.

- [ ] **Step 1: Prueba unitaria que falla** (`leads.test.ts`): `defaultMessage({ name: "Ana López", leadStatus: "nuevo" }, "Uriel")` contiene "Ana", "Uriel" y "Mexico Tech Week"; para `demo_agendada` no contiene "Mexico Tech Week". Implementar → PASS.
- [ ] **Step 2: Implementar página, `TodayRow` y `MyDay`.**
- [ ] **Step 3: Humo**: fijar por SQL `next_action_on = current_date` y `owner_id = <usuario del seed>` a dos contactos; `/leads/hoy` los muestra; el dashboard muestra "Mis leads de hoy · 2"; "Posponer 3 días" los pasa a "Próximos 7 días".
- [ ] **Step 4: `npm run typecheck && npm test`** — PASS.
- [ ] **Step 5: Commit** `feat(leads): vista Hoy con mensaje prellenado, toques y posponer; contador en el dashboard`

---

### Task 12: Convertir lead en cuenta B2B

**Files:**
- Modify: `src/domain/leads.ts` (+ `convertLeadToAccount`), `src/actions/leads.ts` (`convertToAccountAction` real), `src/app/(app)/leads/[id]/page.tsx` (botón visible si tag `clinic` o `jobTitle` contiene director/coordinador; si ya hay cuenta ligada, link "Ver cuenta")
- Test: `src/domain/leads.integration.test.ts`

**Interfaces:**
- `convertLeadToAccount(db: Db, contactId: string, actor: Actor, opts?: { name?: string }): Promise<{ accountId: string; created: boolean }>` — si ya existe `account_contacts` para el contacto devuelve esa cuenta (`created: false`); si no, crea `accounts` (`name = opts.name ?? contact.company ?? \`Clínica de ${contact.name}\``, `type: "clinic"`, `city: contact.cityName ?? null`, `ownerId: contact.ownerId`), `account_contacts` (`title: contact.jobTitle`, `decisionMaker: true`), actividad `sistema` "Convertido en cuenta <nombre>" con `meta.accountId`. No cambia `leadStatus`.

- [ ] **Step 1: Prueba de integración que falla**: convertir dos veces devuelve el mismo `accountId` con `created` true y luego false; `account_contacts` tiene una fila con `decisionMaker = true`; hay una actividad `sistema` con `meta.accountId`.
- [ ] **Step 2: Implementar dominio + action** (`requirePermission("leads.manage")`; el mensaje de éxito es "Cuenta creada." o "Ya tenía cuenta.").
- [ ] **Step 3: Botón en la ficha** → al terminar, `redirect(\`/sales/accounts/${accountId}\`)` (verificar la ruta real de la ficha de cuenta en `src/app/(app)/sales/` y usarla).
- [ ] **Step 4: Correr integración + typecheck** — PASS.
- [ ] **Step 5: Commit** `feat(leads): convertir un lead director en cuenta B2B`

---

### Task 13: Runbook, README y revisión final

**Files:**
- Create: `docs/RUNBOOK-CRM-LEADS.md`
- Modify: `README.md` (tabla "Apartados": Leads), `docs/SETUP-CONEXION.md` (nota: contactos ya no compartidos con Event Ops; corregir el párrafo desactualizado)

- [ ] **Step 1: Escribir el runbook** con: (a) checklist previo al deploy de fase 0: consulta `select u.email, r.role from public.users u left join ops.member_roles r on r.user_id = u.id where u.active` en producción y asignar roles faltantes (Chris admin+ceo, Uriel operations+dev_qa, Eurídice sales, Rafa clinical_director, Ale marketing, Paulina operations) desde Ajustes → Equipo; (b) orden: merge PR fase 0 → deploy automático (la migración 0012 normaliza teléfonos sola) → `npx tsx dev/duplicados-telefono.ts` contra producción vía cloud-sql-proxy (comando y nombres de variables, sin valores) para que Uriel fusione duplicados → importar la hoja MTW con "Registro en Luma" y dueño por defecto Uriel → asignar dueños por segmento según §5 del spec desde `/leads` con selección múltiple; (c) merge PR fase 1 → la migración 0013 corre sola en el deploy; (d) verificación: `/leads/hoy` de cada dueño, `POST /api/jobs/sync-ziora-users` responde con `leads`; (e) rollback: las columnas nuevas no rompen el código anterior; volver a la revisión previa de Cloud Run.
- [ ] **Step 2: Actualizar README y SETUP-CONEXION.**
- [ ] **Step 3: Suite completa**: `npm run typecheck && npm test && RUN_DB_TESTS=1 npm run test:db && npm run build` — todo PASS.
- [ ] **Step 4: Commit** `docs(leads): runbook de despliegue fase 0/1 y apartado Leads en el README`
