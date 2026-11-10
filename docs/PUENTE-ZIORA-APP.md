# Puente con Ziora Copilot (Firebase)

> **Obsoleto.** La app no usa Firestore: sus datos viven en `ziora-api` (Cloud SQL). La integración vigente está en
> [API-ZIORA-APP.md](API-ZIORA-APP.md). Este archivo y `docs/firebase/` quedan solo como referencia.

Ziora Ops lee de la app clínica solo lo necesario para dar seguimiento a los usuarios: plan, estado,
actividad y **cuántos** pacientes y sesiones tiene cada terapeuta. Nunca nombres, notas ni nada de un paciente.

```
Ziora Copilot (Firebase)                         Ziora Ops (Cloud Run)
 ├─ opsSnapshot   (HTTPS, firmada)   ◄── cada hora ── /api/jobs/sync-ziora-users  → ops.app_users, ops.app_user_daily
 └─ opsHelpRequest (trigger Firestore) ── al crearse ─► /api/webhooks/ziora-help  → ops.tickets (origen "App")
```

Las dos direcciones se firman con HMAC-SHA256 del cuerpo en el header `X-Ops-Signature`,
con un mismo secreto: `OPS_BRIDGE_SECRET` en Firebase = `ZIORA_APP_BRIDGE_SECRET` en Ziora Ops.

## Contrato del snapshot

```json
{
  "generatedAt": "2026-11-03T18:00:00Z",
  "users": [{
    "uid": "abc123", "email": "psic@ejemplo.com", "name": "Psic. Ana López",
    "plan": "pro", "status": "active",
    "createdAt": "2026-08-01T15:00:00Z", "lastActiveAt": "2026-11-02T22:10:00Z", "trialEndsAt": null,
    "patientCount": 23, "sessionsLast30d": 41,
    "referredByCode": "CHRIST-ERWK"
  }]
}
```

El esquema es **estricto** (`src/domain/app-users.ts`): si la función manda cualquier campo extra, la
sincronización completa se rechaza y no se guarda nada. Es a propósito: protege contra que algún día se
cuele un dato de paciente. El webhook de ayuda también es estricto.

`referredByCode` (opcional, desde nov-2026): código de referido con el que se registró el terapeuta
(`referrals` → `referral_codes.code`, sin revocados). Si una versión vieja de la app no lo manda, o manda `null`,
Ops conserva el que ya tenía. Alimenta «Referidos por vendedor» en `/leads`.

## Pasos

1. **Secreto compartido**
   ```bash
   openssl rand -hex 32                                   # copia el valor
   firebase functions:secrets:set OPS_BRIDGE_SECRET        # en el proyecto de Ziora Copilot
   printf '<valor>' | gcloud secrets create ziora-ops-app-bridge-secret --data-file=- --project=event-ops-509602
   ```
2. **Funciones en el repo de la app.** Copia `docs/firebase/ops-bridge.ts` a `functions/src/` y **ajusta**:
   - las rutas `USERS`, `PATIENTS`, `SESSIONS` y `HELP` a la estructura real de Firestore;
   - `mapUser()` a los nombres reales de los campos (plan, estado de suscripción, última actividad);
   - `OPS_HELP_WEBHOOK` a la URL de Ziora Ops.

   Despliega con reintentos para el trigger: `firebase deploy --only functions:opsSnapshot,functions:opsHelpRequest`.
3. **Variables en Ziora Ops**
   ```bash
   gcloud run services update ziora-ops --region us-central1 --project event-ops-509602 \
     --update-env-vars ZIORA_APP_SNAPSHOT_URL=<url de opsSnapshot> \
     --update-secrets ZIORA_APP_BRIDGE_SECRET=ziora-ops-app-bridge-secret:latest
   ```
4. **Sincronización cada hora**
   ```bash
   gcloud scheduler jobs create http ziora-ops-sync-app-users --location us-central1 --project event-ops-509602 \
     --schedule "5 * * * *" --http-method POST --uri "$URL/api/jobs/sync-ziora-users" \
     --headers "Authorization=Bearer $(gcloud secrets versions access latest --secret=ziora-ops-job-secret --project event-ops-509602)"
   ```
5. **Precios de planes.** En *Usuarios de Ziora → Precios de planes*, captura el precio de cada plan para el MRR estimado.

## Probar en local sin Firebase

```bash
npm run db:local                                          # Postgres embebido en :5433
ZIORA_APP_BRIDGE_SECRET=local npx tsx dev/fake-ziora-app.ts # opsSnapshot falso en :5055
# en .env: ZIORA_APP_SNAPSHOT_URL=http://localhost:5055/opsSnapshot, ZIORA_APP_BRIDGE_SECRET=local, DB_POOL_MAX=1
curl -X POST -H "Authorization: Bearer localtest" http://localhost:3001/api/jobs/sync-ziora-users
```

## Qué se hace con los datos

- **Activo**: entró en los últimos 14 días (`ACTIVE_DAYS`).
- **De pago**: plan marcado "de pago" y estado sin `trial` ni `cancel`.
- **MRR estimado**: plan × precio, mientras se conecta la fuente real de pagos (pendiente: confirmar si es Stripe).
- **Seguimiento sugerido** (se asigna al director clínico): cliente de pago sin entrar 7+ días o trial que vence en 4 días o menos.
  Si el usuario vuelve a entrar, la sugerencia se cancela sola.
- **Bajas**: si un uid deja de venir en el snapshot, se marca `removed_at` (un snapshot vacío se ignora).

## Rendimiento

`opsSnapshot` hace dos `count()` por terapeuta. Con unos cientos de usuarios tarda segundos. Con miles conviene
guardar `patientCount` en el documento del usuario (contador mantenido por trigger) y leerlo directo.
