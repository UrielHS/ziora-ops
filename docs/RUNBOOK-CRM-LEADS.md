# Runbook · CRM de leads (fases 0, 1 y 2)

Cómo llevar a producción el CRM de leads de Ziora Ops y dejarlo operando. Diseño: `docs/superpowers/specs/2026-11-10-crm-leads-design.md`.
Plan de implementación: `docs/superpowers/plans/2026-11-10-crm-leads-fase0-fase1.md`.

Lo que entra:

- **Fase 0 · acceso e importación.** Permisos `leads.view` / `leads.manage` / `contacts.import` / `campaigns.send`, pantalla "sin rol",
  baja de correo con confirmación (GET muestra botón, POST da de baja), teléfono normalizado (`phone_e164`), importación de la hoja
  de Mexico Tech Week con prioridad, segmento, flag B2B y consentimiento por canal. Migración **0012**.
- **Fase 1 · lead core.** Estados fijos del embudo (`nuevo → contactado → respondió → demo agendada → en trial → pagó`, más `perdido`),
  dueño, prioridad, siguiente paso, timeline (`ops.contact_activities`), `/leads` (kanban), `/leads/[id]` (ficha), `/leads/hoy` (Mi día),
  avance automático desde demos y usuarios de la app, baja → perdido, convertir lead en cuenta B2B. Migración **0013** (backfill).

Las dos fases van en la misma rama (`feat/crm-leads`); se pueden desplegar juntas. Si se separan, primero fase 0.

---

## 1. Antes de desplegar: quién entra y con qué rol

**Entra solo el equipo:** la cuenta de Google debe ser `@ziora-copilot.com` (decisión de Chris, 10-nov-2026) **y** estar activa en
`public.users`, la lista de Event Ops. Cualquier otro correo ve "Tu cuenta no está autorizada", aunque esté en Event Ops.
Los roles ya no deciden la entrada: deciden qué ve cada quien. Quien entra sin rol ve el aviso para pedir uno en Ajustes → Equipo.

Revisar en producción (vía cloud-sql-proxy, ver §2) que las cuentas del equipo existan con ese dominio y qué rol tienen:

```sql
select u.email, u.active, r.role
from public.users u
left join ops.member_roles r on r.user_id = u.id
where u.active
order by u.email, r.role;
```

Asignar lo que falte desde **Ajustes → Equipo** (o insertando en `ops.member_roles`):

| Persona | Roles | Qué puede en leads |
|---|---|---|
| Chris | admin de Event Ops + `ceo` | todo |
| Uriel | `operations`, `dev_qa` | ver y gestionar leads, importar |
| Eurídice | `sales` | ver y gestionar leads, importar, convertir en cuenta |
| Rafa | `clinical_director` | ver y gestionar leads |
| Ale | `marketing` | campañas y contenido; **no lleva leads** (puede verlos) |
| Paulina | `operations` | operación; **no lleva leads** (puede verlos) |

Pau y Ale no hacen ventas (Chris, 10-nov): no se les asignan leads aunque su rol técnicamente se lo permita.

Permisos exactos: `src/lib/permissions.ts`.

## 2. Conexión a la base de producción (solo lectura y fusiones manuales)

Nunca se pegan credenciales en el chat ni en este archivo. Variables que hay que tener en la terminal:

```bash
P=event-ops-509602
R=us-central1
INSTANCE=event-ops-db
cloud-sql-proxy $P:$R:$INSTANCE --port 5439 &
# DATABASE_URL del usuario ziora_ops apuntando a localhost:5439 (el valor sale de Secret Manager, no se escribe aquí)
export DATABASE_URL="postgres://ziora_ops:<contraseña>@localhost:5439/eventops"
```

## 3. Orden de despliegue

1. **Merge del PR** a `main`. El deploy es automático (GitHub Actions → Cloud Run) y corre las migraciones pendientes:
   - `0012_leads_columnas`: columnas nuevas en `ops.contacts`, tabla `ops.contact_activities`, función `ops.normalize_phone_e164`
     y **normaliza todos los teléfonos existentes**. Si dos contactos normalizan al mismo número, el más nuevo se queda sin
     `phone_e164` y con `details.telefono_duplicado_de = <id del otro>`.
   - `0013_leads_backfill`: estado inicial de cada lead a partir de la etiqueta `lead`, de `ops.app_users` (trial/pago) y de la
     última demo. Solo hacia adelante; idempotente. Deja una actividad "Estado inicial por backfill" por lead.
2. **Duplicados por teléfono** (Uriel). Con el proxy levantado:
   ```bash
   npx tsx dev/duplicados-telefono.ts
   ```
   Lista `duplicado → conservado`. Se fusionan a mano en Ziora Ops (pasar notas y etiquetas al conservado y borrar el duplicado
   desde su modal en /contacts). Si no hay filas, no hay nada que hacer.
3. **Importar la hoja de Mexico Tech Week** desde **Contactos → Importar leads (CSV)**:
   - Base de consentimiento: **Registro en Luma (Mexico Tech Week)**. Sin esto los contactos no entran a campañas ni cadencias.
   - Dueño de los leads nuevos: **Uriel** (después se reparte por segmento).
   - Columnas que lee: Nombre, Email, Teléfono, Puesto/Rol, Enfoque, Prioridad (P1 → Alta, P2 → Media, P3–P5 → Baja; el HOT/WARM/COLD va aparte, en Segmento), Segmento, Flag B2B,
     Asistió panel/taller, Ticket panel. El resumen dice cuántos se crearon, se actualizaron, se omitieron y por qué.
   - Quien solo tiene teléfono entra igual (se busca por `phone_e164`).
4. **Repartir dueños** desde `/leads` → marcar "Ver todos", filtrar por prioridad o segmento, seleccionar y **Asignar dueño**,
   según §5 del spec:

   | Segmento | Dueño |
   |---|---|
   | HOT + WARM-A | Rafa |
   | WARM-B + WARM-C | Uriel |
   | Directores de clínica (etiqueta Clínica / flag B2B) | Eurídice |
   | COLD presencial y COLD virtual (~111) | **Por definir** entre Uriel y Eurídice. Mientras tanto quedan sin dueño: los trabaja la cadencia de correo de la fase 2 y quien responda se toma desde el kanban. |

5. Cada dueño abre **`/leads/hoy`** y trabaja su lista: mensaje sugerido (copiar o abrir WhatsApp), "Ya lo mandé",
   "Respondió", posponer, perdido con motivo. El primer toque pasa el lead a Contactado solo.

## 4. Verificación tras el deploy

- `/leads` carga con las siete columnas y los KPIs; arrastrar una tarjeta persiste al recargar y aparece en el historial de la ficha.
- `/leads/hoy` de cada dueño muestra sus leads con siguiente paso; el dashboard muestra "Mis leads de hoy".
- El job de usuarios de la app responde con el bloque `leads`:
  ```bash
  curl -s -X POST "$ZIORA_OPS_URL/api/jobs/sync-ziora-users" -H "Authorization: Bearer $JOBS_TOKEN" | jq '.leads'
  # → { "trial": n, "paid": n }  (cuántos leads avanzaron en esta corrida)
  ```
- Una demo nueva desde ziora-copilot.com/demo deja al contacto en **Demo agendada** y una actividad "Demo agendada para …".
- La baja de correo (`/api/unsubscribe?t=…`) muestra el botón "Sí, darme de baja" y, al confirmar, el lead en trabajo pasa a
  **Perdido · baja**; quien ya está en trial o pagando solo recibe la nota en su historial.
- Consultas útiles:
  ```sql
  select lead_status, count(*) from ops.contacts group by 1 order by 1;
  select type, count(*) from ops.contact_activities group by 1 order by 2 desc;
  ```

## 5. Rollback

Las columnas y tablas nuevas no rompen la revisión anterior del código (todo es nullable o tiene default), así que basta con
**volver a la revisión previa de Cloud Run** (`gcloud run services update-traffic ziora-ops --to-revisions=<rev>=100 --region $R`).
No hace falta revertir las migraciones. Si se quisiera limpiar el estado: `update ops.contacts set lead_status = null …` nunca es
necesario para que la app anterior funcione.

## 6. Reglas que conviene recordar

- El estado **solo avanza solo**: sync, demos y toques nunca regresan a un lead. Regresar o marcar perdido es manual, en la ficha.
- **Perdido exige motivo.** El kanban no permite soltar en Perdido; la ficha y "Mi día" sí (con motivo).
- La **baja de correo gana siempre**: una importación posterior con consentimiento no vuelve a suscribir a quien se dio de baja.
- Las cuentas de prueba (`is_test`) y las borradas de la app no mueven leads.
- Nada clínico vive aquí: un lead es nombre, contacto, puesto, enfoque y lo que la persona dijo; nunca datos de sus pacientes.

## 7. Fase 2 · Cadencia (secuencias de correo + WhatsApp)

Qué es: una secuencia es una lista de pasos con día y canal (la semilla «MTW 4 toques» va D0 correo, D3 WhatsApp, D7 correo,
D14 WhatsApp). Los correos los manda el sistema (Resend): el del día 0 en la siguiente corrida horaria tras enrolar y los demás a las 10:00 CDMX del día que toca; los WhatsApp **no se mandan solos**:
aparecen en `/leads/hoy` del dueño como «Toque N de 4 · WhatsApp» con el texto listo, y «Ya lo mandé» completa el paso.
Se detiene sola al responder, agendar demo, entrar a trial, pagar, marcar perdido o darse de baja. Textos y reglas:
`docs/secuencia-mtw.md`.

### 7.1 Orden tras el merge

1. **Merge del PR** a `main`. `deploy.yml` corre la migración `0014_cadencia` (tres tablas nuevas, dos enums; nada toca
   `ops.contacts`). Hasta aquí no pasa nada visible: no hay secuencias y nadie queda enrolado solo.
2. **Sembrar la secuencia MTW, solo con la aprobación de Chris a los textos** de `docs/secuencia-mtw.md`. Con el proxy de §2:
   ```bash
   export DATABASE_URL=...   # usuario ziora_ops por el túnel, como en §2
   npx tsx dev/seed-secuencia-mtw.ts     # → "creada"; volver a correrlo solo actualiza textos
   ```
   Verificar en `/leads/secuencias`: 4 pasos, 0 activos.
3. **Crear el scheduler** (una vez; `$R`, `$P` y `$URL` como en `docs/SETUP-CONEXION.md`):
   ```bash
   gcloud scheduler jobs create http ziora-ops-run-sequences --location $R --project $P      --schedule "0 8-19 * * *" --time-zone "America/Mexico_City" --http-method POST      --uri "$URL/api/jobs/run-sequences"      --headers "Authorization=Bearer $(gcloud secrets versions access latest --secret=ziora-ops-job-secret --project $P)"
   ```
   Corre cada hora de 08:00 a 19:00 CDMX; fuera de la ventana 08:00–20:00 el job responde `skippedWindow` y no hace nada.
   El paso del día 0 vence al enrolar (sale en la siguiente corrida horaria); los de los días 3, 7 y 14 se programan a las 10:00,
   así que esos salen en la corrida de las 10.
4. **Enrolar por tandas.** Desde `/leads` → «Ver todos» → filtrar (p. ej. COLD sin dueño) → seleccionar **10 leads** →
   «Enrolar en secuencia». Esperar la siguiente corrida horaria (o lanzarla a mano, §7.2), revisar en Resend que
   salieron los 10 correos y que `/leads/secuencias` cuenta 10 activos y 10 correos enviados. Si todo cuadra, el resto por
   tandas de 50. También se puede enrolar al importar la hoja (select «Enrolar en secuencia» en Contactos) y desde la ficha.
   Solo entran leads en **Nuevo** o **Contactado** (los demás se omiten y el mensaje lo dice). Enrolar no revisa canales: a quien
   no tenga correo o permiso se le omite el paso de correo con una actividad `sistema` y se le programa el WhatsApp; sin ningún
   canal termina `sin_canal`. Conviene filtrar antes por consentimiento (Contactos) para no enrolar a quien no se le puede escribir.

### 7.2 Verificación

```bash
curl -s -X POST "$URL/api/jobs/run-sequences"   -H "Authorization: Bearer $(gcloud secrets versions access latest --secret=ziora-ops-job-secret --project $P)"
# → {"ok":true,"sent":n,"pendingWhatsapp":n,"skipped":n,"finished":n,"stopped":n}  (o {"ok":true,"skippedWindow":true} fuera de 08–20 CDMX)
```

- La ficha de un lead enrolado muestra el panel **Cadencia** (estado, N de 4 toques, siguiente paso) y en el historial
  «Enrolado en «MTW 4 toques»» y, tras la corrida, «Secuencia «MTW 4 toques» · toque 1: <asunto>».
- Al día 3, `/leads/hoy` del dueño muestra «Toque 2 de 4 · WhatsApp» con el texto de la secuencia; «Ya lo mandé» lo completa.
  Si el lead no tiene dueño, el WhatsApp aparece en «Ver los de todos»: alguien tiene que tomarlo.
- Consultas útiles:
  ```sql
  select status, stop_reason, count(*) from ops.sequence_enrollments group by 1,2 order by 1,2;
  select count(*) from ops.contact_activities where type = 'correo' and meta ? 'sequenceId';
  ```
- Si un correo falla (Resend caído, llave mal), queda una actividad `sistema` «Paso N de correo falló» y se reintenta en una
  hora; no se pierde el paso.

### 7.3 Rollback

```bash
gcloud scheduler jobs pause ziora-ops-run-sequences --location $R --project $P   # deja de mandar; nada más corre solo
```
```sql
update ops.sequence_enrollments set status = 'detenida', stop_reason = 'rollback', pending_step_id = null, pending_text = null,
  pending_since = null, next_run_at = null where status = 'activa';   -- si hay que parar también los WhatsApp pendientes
```
La migración `0014` no estorba al código anterior: volver a la revisión previa de Cloud Run funciona sin revertirla. Para
reanudar: `gcloud scheduler jobs resume ziora-ops-run-sequences …` y volver a enrolar (los detenidos no se reactivan solos).

## 8. Herramientas del vendedor (ligas, datos incorrectos, dueño, referidos)

Qué es: cada vendedor (Chris, Eurídice, Rafa, Uriel) guarda en **Ajustes → Mi perfil de vendedor** su liga de referido de la app
(`https://ziora-copilot.com/r/<CÓDIGO>`), su liga de calendario (`https://calendar.app.google/…`) y su código de descuento. La ficha
de cada lead las muestra en **Mis ligas** con botón Copiar; la de referido lleva UTM
(`utm_source=ziora_ops&utm_medium=vendedor&utm_campaign=mtw-2026|leads&utm_content=<CÓDIGO>`; `mtw-2026` si el lead vino de la hoja).

### 8.1 Orden tras el merge

1. Deploy normal (`deploy.yml`). La migración `0015_vendedor` es aditiva e idempotente (tabla `ops.seller_profiles`, columnas
   `contacts.email_invalid_at` / `phone_invalid_at`, `app_users.referred_by_code`); volver a la revisión anterior no la necesita revertir.
2. Cada vendedor llena su perfil en Ajustes. Quien tiene `team.manage` ve ahí mismo los perfiles de todo el equipo.
3. Códigos de descuento: se crean en Stripe (Dashboard → Productos → Cupones → cupón con % y vigencia → «Código de promoción», uno por
   vendedor, p. ej. `EURI15`) y se pegan en el perfil. Ops no habla con Stripe: el código es texto para copiar.
4. Referidos por vendedor: el conteo sale del snapshot de la app (`referredByCode`, rama de ziora-gcp `feat/ops-snapshot-referred-by`).
   Hasta que ese cambio esté en prod, la tarjeta de `/leads` dice «La app aún no reporta referidos». Se cuenta por código de referido
   (lo único que la app guarda), no por UTM; cuentas de prueba y bajas no cuentan.

### 8.2 Uso diario

- Ficha → Datos de contacto: Copiar junto a correo y teléfono. «Correo incorrecto» / «Teléfono incorrecto» marcan el dato (no lo borran):
  badge rojo en ficha, kanban y Mi día; la cadencia omite ese paso («Paso N de correo omitido: correo marcado incorrecto») y sigue con el
  siguiente; Mi día deja de ofrecer el WhatsApp. El mismo botón lo desmarca.
- Ficha → Registrar toque: «Le mandé mi liga» deja una nota saliente y, si no había siguiente paso, «Ver si ya se registró» a 2 días;
  «Ya lo está probando» pasa el lead a trial (solo adelante: si ya pagó, no retrocede).
- Kanban: primer nombre del dueño en cada tarjeta y filtro «Dueño» (`?dueno=<uuid>` o `?dueno=ninguno`).

### 8.3 Verificación

```sql
select u.name, p.referral_url, p.booking_url, p.discount_code from ops.seller_profiles p join public.users u on u.id = p.user_id;
select count(*) filter (where email_invalid_at is not null) correo_mal, count(*) filter (where phone_invalid_at is not null) tel_mal from ops.contacts;
select referred_by_code, count(*) from ops.app_users where referred_by_code is not null group by 1 order by 2 desc;
```
