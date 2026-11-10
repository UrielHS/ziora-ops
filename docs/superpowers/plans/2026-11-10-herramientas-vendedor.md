# Herramientas del vendedor · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada vendedor tenga en la ficha del lead sus ligas (referido con UTM, calendario, descuento), copie datos en un clic, registre «liga enviada» / «ya prueba», marque correo o teléfono incorrectos, vea y filtre por dueño, y Ops cuente referidos por vendedor; más favicon y semana del plan.

**Architecture:** Una tabla nueva `ops.seller_profiles` y tres columnas aditivas (migración 0015). Dominio en `src/domain/sellers.ts` (perfil, código, liga con UTM) y funciones nuevas en `src/domain/leads.ts` (marcar inválido, liga enviada, ya prueba). La cadencia (`src/domain/sequences.ts`) respeta los marcados. UI en ficha, kanban, Mi día y Ajustes. El snapshot de la app gana `referredByCode` (rama aparte en ziora-gcp).

**Tech Stack:** Next 15.5 App Router, Drizzle + postgres-js (PGlite local), zod 4, Vitest 5 (`oxc` jsx automático), Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-10-herramientas-vendedor-design.md`

## Global Constraints

- Migración solo aditiva e idempotente (estilo 0014: `IF NOT EXISTS`, `DO $$ … duplicate_object`). Nunca tocar `public.*` salvo FK.
- El sistema está en uso: nada cambia datos existentes de `ops.contacts` salvo por acción explícita del usuario.
- Pruebas solo contra PGlite local (`RUN_DB_TESTS=1 DB_POOL_MAX=1 npx vitest run --no-file-parallelism <archivo>`); suite completa verde antes de cada commit.
- Respetar finales de línea por archivo (HEAD manda; `sed -i 's/\r$//'` tras parches en archivos LF). Commits con `git -c core.autocrlf=false`.
- Español en UI, comentarios, commits (trailer `Claude-Session`). Sin secretos ni PHI en logs.
- Rama `feat/herramientas-vendedor` desde `main` (02c0336). No se mergea sin el go de Chris.

## Review Focus

1. Lead con correo marcado incorrecto y enrollment activo cuyo siguiente paso es correo: el job debe omitir el paso (actividad sistema) y seguir, no fallar ni mandar.
2. Perfil de vendedor con `referral_url` sin `/r/<código>` (p. ej. la raíz del sitio): la liga con UTM se arma igual y el código queda null; la tarjeta de referidos no lo cuenta y no truena.
3. «Ya lo está probando» sobre un lead en `pago`: no retrocede; mensaje claro.
4. Filtro `dueno=ninguno` combinado con `todos=1` y otros filtros: SQL válido, resultados solo sin dueño.
5. Snapshot de la app sin `referredByCode` (versión vieja): el upsert no borra el valor previo ni falla.

---

### Task 1: Semana del plan + favicon

**Files:** Modify `src/db/goals.ts`, `src/app/(app)/dashboard/page.tsx`; Create `src/app/icon.svg`; Test `src/db/goals.test.ts` (crear).

- [ ] Test `gtmWeekLabel(now)`: 2026-11-09 → "Semana 1 de 12 del plan de 90 días"; 2026-11-16 → semana 2; 2027-02-01 (semana 13) → null; 2026-11-08 → null.
- [ ] Verificar RED (función no existe).
- [ ] Implementar `GTM_START = "2026-11-09"`, `GTM_WEEKS = 12`, `export function gtmWeekLabel(now = new Date()): string | null`; usarla en el dashboard en lugar del cálculo inline.
- [ ] `src/app/icon.svg`: cuadro 64×64 radio 14 fill `#507060`, marca blanca (paths del safari-pinned-tab escalados y centrados), ojo `#507060`.
- [ ] Verificar GREEN + typecheck. Commit `feat(ops): semana del plan de 90 días y favicon`.

### Task 2: Migración 0015 + esquema

**Files:** Modify `src/db/schema.ts`; Create `drizzle/0015_vendedor.sql` (+ entrada en `drizzle/meta/_journal.json`); Test `src/domain/sellers.integration.test.ts` (crear, prueba de re-aplicación).

**Produces:** `sellerProfiles` (userId, referralUrl, bookingUrl, discountCode, updatedAt); `contacts.emailInvalidAt`, `contacts.phoneInvalidAt`; `appUsers.referredByCode`.

- [ ] Test "la migración 0015 se puede volver a aplicar sin error" (misma técnica que 0014) y "seller_profiles acepta un perfil por usuario" (insert dos veces → segundo falla por PK).
- [ ] RED. Escribir `0015_vendedor.sql` idempotente y el esquema Drizzle; `npm run db:migrate` local.
- [ ] GREEN. Commit `feat(ops): migración 0015 perfiles de vendedor, correo/teléfono inválidos, referido en app_users`.

### Task 3: Dominio de vendedor + Ajustes

**Files:** Create `src/domain/sellers.ts`, `src/domain/sellers.test.ts`, `src/actions/sellers.ts`, `src/components/sellers.tsx`; Modify `src/app/(app)/settings/page.tsx`.

**Produces:** `referralCodeFrom(url: string | null): string | null`; `referralLinkWithUtm(url: string, opts: { campaign: string; code: string | null }): string`; `getSellerProfile(db, userId)`, `upsertSellerProfile(db, userId, data)`; `SellerProfileForm`.

- [ ] Unit tests: `referralCodeFrom("https://ziora-copilot.com/r/CHRIST-ERWK")` → "CHRIST-ERWK"; raíz → null; `referralLinkWithUtm` conserva path, agrega utm_source=ziora_ops, utm_medium=vendedor, utm_campaign, utm_content=código (omitido si null); URL que ya trae query → se concatena con `&`.
- [ ] RED → implementar → GREEN.
- [ ] Integration test: upsert crea y actualiza (mismo user_id).
- [ ] Action `saveSellerProfileAction` (zod: URLs https opcionales, código `^[A-Z0-9-]{3,32}$` opcional, mayúsculas). Tarjeta «Mi perfil de vendedor» en Ajustes con los tres campos y, para `team.manage`, tabla de perfiles del equipo.
- [ ] Suite verde, typecheck. Commit `feat(ops): perfil de vendedor (liga de referido, calendario, código) en Ajustes`.

### Task 4: Ficha del lead: copiar, Mis ligas, liga enviada, ya prueba

**Files:** Modify `src/domain/leads.ts`, `src/domain/leads.integration.test.ts`, `src/actions/leads.ts`, `src/components/leads.tsx`, `src/app/(app)/leads/[id]/page.tsx`.

**Produces:** `recordReferralLinkSent(db, contactId, actor, now?)`; `markTrying(db, contactId, actor): Promise<{ ok: boolean; message?: string }>`.

- [ ] Integration tests: `recordReferralLinkSent` crea actividad nota saliente con `meta.kind = "referral_link"` y pone next_action «Ver si ya se registró» a +2 días solo si no había; `markTrying` nuevo → en_trial con actividad cambio_estado; en `pago` → `{ ok: false, message }` y sin cambio.
- [ ] RED → implementar → GREEN.
- [ ] UI: `CopyButton` junto a correo y teléfono; tarjeta «Mis ligas» (perfil del usuario actual; campaña `mtw-2026` si `source === "sheet_import"`); botones «Le mandé mi liga» y «Ya lo está probando» en Registrar toque.
- [ ] Render test en `leads.test.tsx`: tarjeta «Mis ligas» con perfil muestra las tres ligas; sin perfil muestra la liga a Ajustes.
- [ ] Commit `feat(ops): ficha del lead con copiar, Mis ligas, liga enviada y ya prueba`.

### Task 5: Correo o teléfono incorrecto

**Files:** Modify `src/domain/leads.ts` (+ test), `src/domain/sequences.ts`, `src/domain/sequences.integration.test.ts`, `src/actions/leads.ts`, `src/components/leads.tsx`, `src/app/(app)/leads/[id]/page.tsx`, `src/app/(app)/leads/hoy/page.tsx`.

**Produces:** `setChannelInvalid(db, contactId, channel: "email" | "phone", invalid: boolean, actor)`.

- [ ] Integration tests: marcar correo → `emailInvalidAt` no nulo + actividad nota «Marcó el correo como incorrecto»; desmarcar → null. Job: lead con correo inválido y paso de correo → actividad «Paso 1 de correo omitido: correo marcado incorrecto», avanza al paso 2, `sent` = 0. Lead con teléfono inválido y paso WhatsApp → omitido con «teléfono marcado incorrecto».
- [ ] RED → implementar (en `loadCtx`, `why` incluye los marcados) → GREEN.
- [ ] UI: botones alternantes en Datos de contacto; badge rojo en ficha, `LeadCard` y `TodayRow`; `TodayRow` sin botón WhatsApp si teléfono marcado.
- [ ] Commit `feat(ops): marcar correo o teléfono incorrecto; la cadencia los omite`.

### Task 6: Dueño visible y filtro

**Files:** Modify `src/components/leads.tsx` (LeadCard), `src/app/(app)/leads/page.tsx`, `src/domain/leads.ts` (+ unit test).

**Produces:** `ownerFilter(param: string | undefined): { kind: "any" } | { kind: "none" } | { kind: "user"; id: string }`.

- [ ] Unit test: undefined → any; "ninguno" → none; uuid → user; basura → any.
- [ ] RED → implementar → GREEN. Kanban: Select «Dueño» en filtros; `LeadCard` muestra primer nombre junto al avatar.
- [ ] Commit `feat(ops): filtro por dueño y nombre del dueño en el kanban`.

### Task 7: Referidos por vendedor

**Files (Ops):** Modify `src/domain/app-users.ts` (+ integration test), `src/app/(app)/leads/page.tsx`, Create `src/domain/referrals.ts` (+ test).
**Files (app, repo ziora-gcp, rama `feat/ops-snapshot-referred-by`):** Modify `backend/app/modules/ops_bridge/models.py`, `service.py`, `backend/tests/test_ops_snapshot.py`.

**Produces:** `referralsBySeller(db): Promise<{ userId; name; code; signups; paying }[]>`.

- [ ] Ops: Snapshot zod gana `referredByCode: z.string().max(32).nullable().optional()`; upsert lo guarda; si viene ausente no sobreescribe (test).
- [ ] Ops: `referralsBySeller` une `seller_profiles` (código derivado) con `app_users.referred_by_code` (test con datos sembrados). Tarjeta en `/leads` (o aviso si nadie tiene código / la app no reporta).
- [ ] App: `SnapshotUser.referredByCode: Optional[str]`; `build_snapshot` carga en una consulta `Referral.referred_therapist_id → ReferralCode.code` para los ids de la página; test en `test_ops_snapshot.py`. Commit en ziora-gcp; NO desplegar (PR cuando Chris dé el go).
- [ ] Commit Ops `feat(ops): referidos por vendedor desde el snapshot de la app`.

### Task 8: Documentación

**Files:** Modify `docs/RUNBOOK-CRM-LEADS.md` (§8 Herramientas del vendedor: perfil, ligas, inválidos, referidos, cómo crear códigos en Stripe), `README.md` (tabla de módulos), `docs/PUENTE-ZIORA-APP.md` (campo nuevo).

- [ ] Escribir; `npm run build` con el dev server apagado; commit `docs(ops): herramientas del vendedor`.
