# Conectar Ziora Ops con Event Ops y ponerlo en producción

Ziora Ops es un servicio de Cloud Run aparte, en el **mismo proyecto GCP** (`event-ops-509602`)
y la **misma instancia y base de Cloud SQL** (`event-ops-db` / `eventops`) que Event Ops.

```
Cloud SQL  event-ops-db / base eventops
├── schema public   ← dueño: Event Ops   (users, contacts, contact_tags, organizations, events…)
└── schema ops      ← dueño: Ziora Ops   (tasks, demo_requests, bugs, pull_requests, campaigns…)

Event Ops  (Cloud Run event-ops)  usuario BD: eventops   → todo public; lee ops (opcional)
Ziora Ops  (Cloud Run ziora-ops)  usuario BD: ziora_ops  → lee public (users, events, contacts), dueño de ops
```

Los contactos **ya no son compartidos**: Ziora Ops tiene los suyos en `ops.contacts` (con estado de lead, dueño,
teléfono normalizado y timeline) y copia los de Event Ops cuando alguien lo pide desde Contactos → Importar de Event Ops
(`event_ops_contact_id` guarda el origen). Las dos apps sí usan el mismo login de Google y la misma lista de `users`.

**Quién corre qué:** los pasos con IAM (1, 4 y 5) requieren permisos de dueño del proyecto, así que
los corre Chris. El resto lo puede hacer cualquiera que tenga `gcloud` autenticado con acceso al proyecto.

En todos los comandos:

```bash
P=event-ops-509602
PN=845770051786
R=us-central1
INSTANCE=event-ops-db
```

---

## 0. Migración en Event Ops (primero)

Agrega a los enums compartidos los valores que usa Ziora (`psychologist`, `lead`, `demo_form`, `gdl`, `mty`…).
Instrucciones exactas: `docs/event-ops-patch/README.md`. Entra por PR a Event Ops y su deploy aplica la migración.
**Ziora Ops no funciona sin esta migración**: insertar la etiqueta `psychologist` fallaría.

## 1. Usuario de base de datos `ziora_ops` (Chris)

```bash
ZPASS=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)
gcloud sql users create ziora_ops --instance=$INSTANCE --password="$ZPASS" --project=$P
printf '%s' "$ZPASS" | gcloud secrets create ziora-ops-db-password --data-file=- --project=$P
unset ZPASS
```

Luego abre el proxy y corre los permisos **como `eventops`** (dueño de las tablas):

```bash
cloud-sql-proxy $P:$R:$INSTANCE --port 5439 &
PGPASSWORD=$(gcloud secrets versions access latest --secret=db-password --project $P) \
  psql "host=localhost port=5439 dbname=eventops user=eventops" -f docs/sql/01-permisos-ziora-ops.sql
```

Qué otorga: lectura de `users`, `events`, `event_contacts`, `organizations`; lectura y escritura (sin borrar)
de `contacts` y `contact_tags`; permiso para crear su propio schema `ops`. Ziora Ops **no puede** borrar
contactos ni tocar eventos, finanzas o patrocinios de Event Ops.

## 2. Primera migración de Ziora Ops

Con el proxy aún abierto, desde este repo:

```bash
npm ci
ZENC=$(gcloud secrets versions access latest --secret=ziora-ops-db-password --project $P | node -e 'process.stdin.on("data",d=>process.stdout.write(encodeURIComponent(d.toString())))')
DATABASE_URL="postgres://ziora_ops:${ZENC}@localhost:5439/eventops" npm run db:migrate
```

Opcional, para que Event Ops pueda leer demos y consentimientos más adelante:

```bash
PGPASSWORD=$(gcloud secrets versions access latest --secret=ziora-ops-db-password --project $P) \
  psql "host=localhost port=5439 dbname=eventops user=ziora_ops" -f docs/sql/02-lectura-ops-desde-event-ops.sql
```

Cierra el proxy matando solo su PID.

## 3. Secretos de la app

```bash
for S in ziora-ops-auth-secret ziora-ops-unsubscribe-secret ziora-ops-job-secret \
         ziora-ops-demo-webhook-secret ziora-ops-github-webhook-secret ziora-ops-bug-intake-key; do
  openssl rand -base64 32 | tr -d '\n' | gcloud secrets create $S --data-file=- --project=$P
done
# Se llenan cuando existan (pasos 8 y 9):
printf 'pendiente' | gcloud secrets create ziora-ops-resend-api-key     --data-file=- --project=$P
printf 'pendiente' | gcloud secrets create ziora-ops-resend-webhook-secret --data-file=- --project=$P
printf 'pendiente' | gcloud secrets create ziora-ops-github-token       --data-file=- --project=$P
```

El cliente OAuth de Google **se reutiliza** del de Event Ops. Para ver con qué nombre están sus secretos:

```bash
gcloud run services describe event-ops --region $R --project $P --format=export | grep -A2 -i "AUTH_GOOGLE"
```

## 4. Cuenta de servicio de ejecución (Chris)

```bash
gcloud iam service-accounts create ziora-ops-runtime --display-name="Ziora Ops runtime" --project=$P
RSA=ziora-ops-runtime@$P.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$RSA" --role=roles/cloudsql.client --condition=None
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$RSA" --role=roles/secretmanager.secretAccessor --condition=None
# Que el deployer de GitHub pueda desplegar con esta identidad
gcloud iam service-accounts add-iam-policy-binding $RSA \
  --member="serviceAccount:github-deployer@$P.iam.gserviceaccount.com" --role=roles/iam.serviceAccountUser --project=$P
```

## 5. Permitir que este repo despliegue (Chris)

El proveedor OIDC hoy solo acepta `chrislfmd/event-ops`. Hay que agregar este repo:

```bash
gcloud iam workload-identity-pools providers update-oidc github-oidc \
  --location=global --workload-identity-pool=github --project=$P \
  --attribute-condition="assertion.repository in ['chrislfmd/event-ops', 'UrielHS/ziora-ops']"

gcloud iam service-accounts add-iam-policy-binding github-deployer@$P.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser --project=$P \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository/UrielHS/ziora-ops"
```

Si después se transfiere el repo a una org de Ziora, hay que repetir este paso con el nuevo nombre.

## 6. Primer despliegue (manual, una sola vez)

Fija la configuración del servicio. Los despliegues siguientes (GitHub Actions) solo cambian la imagen.
Sustituye `<SECRETO_GOOGLE_ID>` y `<SECRETO_GOOGLE_SECRET>` por los nombres que viste en el paso 3.

```bash
gcloud builds submit --tag $R-docker.pkg.dev/$P/event-ops/ziora-ops:inicial --project $P

gcloud run deploy ziora-ops \
  --image $R-docker.pkg.dev/$P/event-ops/ziora-ops:inicial \
  --region $R --project $P \
  --service-account ziora-ops-runtime@$P.iam.gserviceaccount.com \
  --add-cloudsql-instances $P:$R:$INSTANCE \
  --allow-unauthenticated \
  --set-env-vars "DB_SOCKET_PATH=/cloudsql/$P:$R:$INSTANCE,DB_NAME=eventops,DB_USER=ziora_ops,AUTH_TRUST_HOST=true,MAIL_FROM=Ziora <hola@mail.ziora-copilot.com>,GITHUB_REPOS=OWNER/REPO" \
  --set-secrets "DB_PASSWORD=ziora-ops-db-password:latest,AUTH_SECRET=ziora-ops-auth-secret:latest,AUTH_GOOGLE_ID=<SECRETO_GOOGLE_ID>:latest,AUTH_GOOGLE_SECRET=<SECRETO_GOOGLE_SECRET>:latest,UNSUBSCRIBE_SECRET=ziora-ops-unsubscribe-secret:latest,JOB_SECRET=ziora-ops-job-secret:latest,DEMO_WEBHOOK_SECRET=ziora-ops-demo-webhook-secret:latest,GITHUB_WEBHOOK_SECRET=ziora-ops-github-webhook-secret:latest,BUG_INTAKE_KEY=ziora-ops-bug-intake-key:latest,RESEND_API_KEY=ziora-ops-resend-api-key:latest,RESEND_WEBHOOK_SECRET=ziora-ops-resend-webhook-secret:latest,GITHUB_TOKEN=ziora-ops-github-token:latest"

URL=$(gcloud run services describe ziora-ops --region $R --project $P --format='value(status.url)')
gcloud run services update ziora-ops --region $R --project $P --update-env-vars APP_URL=$URL
curl $URL/api/health     # {"ok":true}
```

`--allow-unauthenticated` es necesario porque los webhooks entran desde fuera; las páginas igual
exigen sesión y cada webhook valida su firma.

## 7. Login con Google

En Google Cloud Console → APIs y servicios → Credenciales → el cliente OAuth de Event Ops →
**URIs de redirección autorizados**, agrega:

```
<URL de ziora-ops>/api/auth/callback/google
http://localhost:3001/api/auth/callback/google
```

Entra quien esté activo en `public.users`. Se da de alta desde Event Ops (Settings → Users).

## 8. Correo saliente

**Opción usada en prod (10-nov-2026): relay SMTP de Google Workspace**, sin proveedor nuevo. En Cloud Run:
`SMTP_HOST=smtp-relay.gmail.com`, `SMTP_PORT=587`, `SMTP_USERNAME=<usuario de Workspace>`, secreto `SMTP_PASSWORD`
(contraseña de aplicación; en Ops es `ziora-ops-smtp-password`, copia de `prod-smtp-password` de ziora-ehr) y `MAIL_FROM`
con una dirección @ziora-copilot.com. El relay ya está activado en Admin (Apps → Gmail → Enrutamiento → Relay SMTP) y el
dominio firma DKIM con Google. Lo de abajo (Resend) queda como alternativa si algún día hace falta volumen o webhooks.

### 8.1 Alternativa: correo masivo con Resend

1. Crea la cuenta en resend.com y agrega el dominio **`mail.ziora-copilot.com`** (subdominio). Así,
   si una campaña genera quejas de spam, no se daña la reputación del correo principal del equipo.
2. Copia en tu DNS los registros que da Resend (SPF/MX y DKIM), y agrega DMARC:
   `_dmarc.mail.ziora-copilot.com  TXT  "v=DMARC1; p=none; rua=mailto:hola@ziora-copilot.com"`.
3. API key con permiso de envío → `gcloud secrets versions add ziora-ops-resend-api-key --data-file=-`.
4. Webhooks → endpoint `<URL>/api/webhooks/resend`, eventos `email.*` → copia el signing secret
   → `gcloud secrets versions add ziora-ops-resend-webhook-secret --data-file=-`.

Reglas que el código ya hace cumplir:
- Solo recibe campañas quien tiene `ops.contact_consents.opt_in = true` (LFPDPPP). Los contactos que
  vienen de Event Ops (Luma, LinkedIn, eventos) **no** tienen consentimiento por defecto.
- Cada correo lleva un enlace de baja y el header `List-Unsubscribe` de un clic. Una baja nunca se revierte sola.
- Un rebote o una queja de spam dan de baja automáticamente.

## 9. GitHub (PRs)

1. Token fine-grained en github.com/settings/tokens, con acceso de solo lectura a los repos de Ziora:
   *Pull requests: Read*, *Checks: Read*, *Contents: Read*, *Metadata: Read*. Si los repos son de la org
   de Chris, él debe aprobar el token o generarlo.
   → `gcloud secrets versions add ziora-ops-github-token --data-file=-`
2. Actualiza `GITHUB_REPOS=owner/repo1,owner/repo2` en el servicio.
3. En cada repo: Settings → Webhooks → `<URL>/api/webhooks/github`, `application/json`, secreto
   `ziora-ops-github-webhook-secret`, eventos **Pull requests** y **Pull request reviews**.
4. Respaldo cada 30 minutos (por si se pierde un webhook):

```bash
gcloud scheduler jobs create http ziora-ops-sync-github --location $R --project $P \
  --schedule "*/30 * * * *" --http-method POST --uri "$URL/api/jobs/sync-github" \
  --headers "Authorization=Bearer $(gcloud secrets versions access latest --secret=ziora-ops-job-secret --project $P)"
```

## 9b. Cadencia de leads (secuencias)

Los correos de las secuencias salen por Resend (§8) y los lanza un job cada hora dentro de la ventana 08:00–20:00 CDMX.
Se crea una vez, después del primer deploy con la migración `0014_cadencia` (detalle, semilla y rollback en
`docs/RUNBOOK-CRM-LEADS.md` §7):

```bash
gcloud scheduler jobs create http ziora-ops-run-sequences --location $R --project $P   --schedule "0 8-19 * * *" --time-zone "America/Mexico_City" --http-method POST   --uri "$URL/api/jobs/run-sequences"   --headers "Authorization=Bearer $(gcloud secrets versions access latest --secret=ziora-ops-job-secret --project $P)"
```

## 10. Demos desde el Google Calendar del CEO

Las demos de ziora-copilot.com/demo se agendan directo en el calendario del CEO. Ziora Ops lee ese calendario
cada 10 minutos y refleja cada demo en el pipeline: la crea (y crea o completa el contacto en `ops.contacts`,
con etiquetas `psychologist` y `lead`, y pasa el lead a **Demo agendada**), la reagenda si cambió la hora y la marca como
perdida si se canceló (el lead no retrocede; queda en su historial).

Solo se leen eventos que contengan `DEMO_EVENT_MATCH` (por defecto "Demo") y que tengan un invitado externo.
El resto de la agenda del CEO no se lee ni se guarda. El permiso pedido es de solo lectura (`calendar.events.readonly`).

**Requisito: la cuenta del CEO debe ser de Google Workspace** (por ejemplo `chris@ziora-copilot.com`). Con una cuenta
de Gmail personal la delegación de dominio no existe; en ese caso avísame y lo cambiamos a un consentimiento OAuth del CEO.

1. **Delegación de dominio (admin de Workspace de ziora-copilot.com).** En admin.google.com → Seguridad →
   Acceso y control de datos → Controles de API → Delegación de todo el dominio → Agregar:
   - Client ID: el de `event-ops-ingest` (Event Ops usa `113668842088465677612`; confírmalo con
     `gcloud iam service-accounts describe event-ops-ingest@event-ops-509602.iam.gserviceaccount.com --format='value(oauth2ClientId)'`)
   - Scope: `https://www.googleapis.com/auth/calendar.events.readonly`
   Si ya está registrado para Event Ops con `calendar.readonly`, agrega este scope a la misma entrada.

2. **Permiso para firmar como esa cuenta (Chris):**

```bash
gcloud iam service-accounts add-iam-policy-binding event-ops-ingest@$P.iam.gserviceaccount.com \
  --member="serviceAccount:ziora-ops-runtime@$P.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator --project=$P
gcloud services enable iamcredentials.googleapis.com calendar-json.googleapis.com --project=$P
```

3. **Variables del servicio:**

```bash
gcloud run services update ziora-ops --region $R --project $P --update-env-vars \
  "GOOGLE_INGEST_SA=event-ops-ingest@$P.iam.gserviceaccount.com,GOOGLE_CALENDAR_SUBJECT=<correo del CEO>,DEMO_CALENDAR_ID=primary,DEMO_EVENT_MATCH=Demo"
```

   `DEMO_EVENT_MATCH` debe ser una palabra que siempre aparezca en el título de los eventos de demo
   (revisa un evento real). `DEMO_CALENDAR_ID` cambia si las demos caen en un calendario secundario.

4. **Sincronización cada 10 minutos:**

```bash
gcloud scheduler jobs create http ziora-ops-sync-demos --location $R --project $P \
  --schedule "*/10 * * * *" --http-method POST --uri "$URL/api/jobs/sync-demos" \
  --headers "Authorization=Bearer $(gcloud secrets versions access latest --secret=ziora-ops-job-secret --project $P)"
```

5. **Probar:** en Demos → "Leer calendario ahora". Si falla con `unauthorized_client`, falta el paso 1.

**Cómo se interpreta cada evento.** Del invitado externo salen el correo y el nombre. De la descripción salen
WhatsApp, pacientes por semana, teleterapia, ciudad y "lo que más te quita tiempo". El parser acepta el formato
de Programación de citas de Google (pregunta y respuesta en líneas seguidas) y líneas `Etiqueta: valor`.
Si con un evento real algún campo sale vacío, mándame la descripción con datos ficticios y ajusto el parser.

**Permiso de correo.** Agendar una demo no equivale a aceptar campañas. Esas demos entran sin opt-in.
Si el formulario agrega la casilla de aceptación, se registra el permiso por contacto.

**Webhook alternativo.** `POST /api/webhooks/demo` (firmado con HMAC) sigue disponible si algún día el
formulario guarda en la base de Ziora en vez del calendario.

## 11. Desarrollo local

Opción A, sola (recomendada para ver la app): `docker compose up -d` en este repo levanta Postgres en :5433
con el schema de Event Ops (`dev/eventops-public-schema.sql`). Luego `npm run db:setup` y `npm run dev`.

Opción B, compartiendo con tu Event Ops local: apunta `DATABASE_URL` a `localhost:5432/eventops` (con la
migración 0012 ya aplicada allá) y corre solo `npm run db:migrate`. No uses `db:seed` ahí si tienes datos reales.
