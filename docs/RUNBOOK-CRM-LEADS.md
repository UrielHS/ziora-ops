# Runbook · CRM de leads (fase 0 y fase 1)

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

## 1. Antes de desplegar: roles en producción

El CRM se ve y se opera por rol. Quien entra a Event Ops pero no tiene rol en Ziora Ops verá la pantalla "Tu cuenta no tiene rol".
Revisar en producción (vía cloud-sql-proxy, ver §2):

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
| Ale | `marketing` | ver y gestionar leads, importar, enviar campañas |
| Paulina | `operations` | ver y gestionar leads, importar |

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
   - Columnas que lee: Nombre, Email, Teléfono, Puesto/Rol, Enfoque, Prioridad (1–5 → HOT/WARM/COLD), Segmento, Flag B2B,
     Asistió panel/taller, Ticket panel. El resumen dice cuántos se crearon, se actualizaron, se omitieron y por qué.
   - Quien solo tiene teléfono entra igual (se busca por `phone_e164`).
4. **Repartir dueños** desde `/leads` → marcar "Ver todos", filtrar por prioridad o segmento, seleccionar y **Asignar dueño**,
   según §5 del spec:

   | Segmento | Dueño |
   |---|---|
   | HOT + WARM-A | Rafa |
   | WARM-B + WARM-C | Uriel |
   | Directores de clínica (etiqueta Clínica / flag B2B) | Eurídice |
   | COLD presencial y COLD virtual | Ale |

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
- La baja de correo (`/api/unsubscribe?token=…`) muestra el botón "Sí, darme de baja" y, al confirmar, el lead en trabajo pasa a
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
