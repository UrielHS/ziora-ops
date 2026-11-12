# Integración ziora-api → Ziora Ops

Especificación de los tres endpoints que `ziora-api` debe exponer o llamar para que Ziora Ops muestre los datos de la app.
Está escrita para implementarse con Claude Code dentro del repo de `ziora-api`.

## 1. Qué es Ziora Ops

Ziora Ops es el CRM y sistema operativo interno del equipo de Ziora. Ahí se registra todo lo que se está haciendo:

| Área | Qué se lleva ahí |
| --- | --- |
| Operación | Tareas, bloqueos, épicas y el dashboard "Mi día" por rol |
| Ventas | Cuentas (clínicas), oportunidades, contratos, demos y contactos |
| Clientes | Usuarios de la app Ziora, salud de cada cuenta y seguimiento 1:1 |
| Marketing | Calendario de contenido, revisión, redes sociales, anuncios y correo masivo |
| Producto | Tickets, QA y bugs, pull requests |
| Métricas | Indicadores semanales de todo lo anterior |

- **Dónde corre:** Next.js en Cloud Run, proyecto `event-ops-509602` (us-central1), servicio `ziora-ops`.
- **Base de datos:** comparte base y login de Google con Event Ops. Los contactos son los mismos en los dos sistemas.
- **Usuarios:** solo el equipo interno, con roles (CEO, ventas, director clínico, marketing, operaciones, dev/QA).

### Para qué necesita datos de la app

1. **Usuarios y suscripciones:** ver quién usa la app, con qué plan, cuánto paga y qué tan activo está. Con eso:
   - Ziora Ops sugiere seguimientos 1:1 al director clínico: cuentas de pago que no entran en 7 días y trials que vencen en 4 días o menos.
   - Calcula el MRR real y sus tendencias.
2. **Ayuda y sugerencias:** cada mensaje de un terapeuta se vuelve un ticket con responsable y estado.
3. **Demos y leads:** cada demo de la landing entra sola al pipeline de ventas, con sus UTM, para medir el costo real por demo y por cliente.

## 2. Resumen

| # | Endpoint | Quién llama | Cuándo | Firma |
| --- | --- | --- | --- | --- |
| 1 | `POST {ziora-api}/ops/snapshot` | Ziora Ops | Cada hora (Cloud Scheduler) | `X-Ops-Signature` con `OPS_BRIDGE_SECRET` |
| 2 | `POST {OPS_BASE_URL}/api/webhooks/ziora-help` | ziora-api | Al crearse cada solicitud de ayuda | `X-Ops-Signature` con `OPS_BRIDGE_SECRET` |
| 3 | `POST {OPS_BASE_URL}/api/webhooks/demo` | ziora-api | Al crearse, reagendarse o cancelarse una demo o lead | `X-Ziora-Signature` con `OPS_DEMO_WEBHOOK_SECRET` |

## 3. Configuración y seguridad

### Variables (Cloud Run de `ziora-api` y `ziora-api-staging`)

Los secretos viven en Secret Manager de `event-ops-509602`. La cuenta con la que corre `ziora-api`
(`717696530354-compute@developer.gserviceaccount.com`) ya tiene permiso de lectura solo sobre esos dos.
No hay que copiar valores: Cloud Run los lee por referencia, y si se rotan, ziora-api toma el nuevo al redesplegar.

| Variable | Tipo | Valor |
| --- | --- | --- |
| `OPS_BRIDGE_SECRET` | Secreto | `projects/845770051786/secrets/ziora-ops-app-bridge-secret:latest`. En Ziora Ops es `ZIORA_APP_BRIDGE_SECRET`. |
| `OPS_DEMO_WEBHOOK_SECRET` | Secreto | `projects/845770051786/secrets/ziora-ops-demo-webhook-secret:latest`. En Ziora Ops es `DEMO_WEBHOOK_SECRET`. |
| `OPS_BASE_URL` | Variable | `https://ziora-ops-qlbjkgrofq-uc.a.run.app` (sin barra final). Cambiará a `https://ops.ziora-copilot.com`. |

```bash
gcloud run services update ziora-api --region us-central1 --project ziora-ehr \
  --update-secrets OPS_BRIDGE_SECRET=projects/845770051786/secrets/ziora-ops-app-bridge-secret:latest,OPS_DEMO_WEBHOOK_SECRET=projects/845770051786/secrets/ziora-ops-demo-webhook-secret:latest \
  --update-env-vars OPS_BASE_URL=https://ziora-ops-qlbjkgrofq-uc.a.run.app
```

Lo mismo para `ziora-api-staging`.

### Firma

```
firma = hex( HMAC-SHA256( secreto, bytes exactos del cuerpo ) )
```

- Se firma el cuerpo tal como viaja: no lo re-serialices después de firmar.
- Al verificar (endpoint 1), calcula la firma sobre el cuerpo **crudo**, antes de parsear el JSON, y compara en tiempo constante (`hmac.compare_digest` o equivalente).
- Al enviar (endpoints 2 y 3): serializa una vez, firma esos bytes y manda esos mismos bytes.

### Reglas de datos

- **Ningún dato de un paciente sale de la app.** Solo conteos.
- No se descifran campos cifrados (`FIELD_ENCRYPTION_KEY`) para esta integración.
- Ziora Ops valida cada respuesta con un esquema estricto: si llega una llave que no está en este documento, **rechaza la sincronización completa** y no guarda nada.
- En los endpoints 2 y 3, las llaves opcionales sin valor **se omiten**. No mandes `null`, porque Ziora Ops lo rechaza con 400.

## 4. Endpoint 1 — `POST /ops/snapshot`

### Petición (la hace Ziora Ops)

```http
POST /ops/snapshot
Content-Type: application/json
X-Ops-Signature: 3f1c…(hex)

{"requestedAt":"2026-11-05T18:00:00.000Z","v":2}
```

### Validación

| Caso | Respuesta |
| --- | --- |
| Falta la firma o no coincide | `401` |
| `requestedAt` con más de 5 minutos de antigüedad o más de 1 minuto en el futuro | `401` (evita repeticiones) |
| Correcta | `200` con el snapshot |

- Versión 2: Ops manda `"v": 2` en el cuerpo (exactamente el entero 2). Solo entonces el usuario trae, además, `attribution` (objeto con `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, `ref`, texto ≤ 200, o `null`), `trialKind` (`"community"` o `null`), `hasPaidInvoice` (booleano: alguna suscripción con factura pagada > 0), `feedbackCount`, `sessionsTotal` y `notesTotal` (enteros ≥ 0). Sin `v: 2` la respuesta es idéntica a la v1. Ops guarda `attribution` y `trialKind` de forma permanente (null o vacío no los borran) y liga al usuario con su comunidad/post por `utm_term` (código del post) o `utm_content` (slug de la comunidad). Contrato completo en `ziora-gcp/docs/ZIORA-OPS-INTEGRACION.md`.
- Sin sesión de usuario ni CORS. El endpoint no aparece en la documentación pública ni en OpenAPI.
- Si el repo tiene rate limiting global, exceptúa esta ruta o dale un límite propio (1 petición por minuto basta).

### Respuesta `200`

```json
{
  "generatedAt": "2026-11-05T18:00:02Z",
  "users": [
    {
      "uid": "9b2e…",
      "email": "psic.ana@ejemplo.com",
      "name": "Psic. Ana López",
      "plan": "pro",
      "status": "active",
      "createdAt": "2026-08-01T15:00:00Z",
      "lastActiveAt": "2026-11-04T22:10:00Z",
      "trialEndsAt": null,
      "patientCount": 23,
      "sessionsLast30d": 41,
      "billingPeriod": "annual",
      "mrrAmount": 491.67,
      "currency": "mxn",
      "currentPeriodEnd": "2027-08-01T15:00:00Z",
      "cancelAtPeriodEnd": false
    }
  ]
}
```

### Campos de cada usuario

| Campo | Tipo | Obligatorio | Definición |
| --- | --- | --- | --- |
| `uid` | string, 1–128 | Sí | Id estable del terapeuta en la app |
| `email` | string, correo válido | Sí | Correo de la cuenta |
| `name` | string ≤ 200 o `null` | No | Nombre visible |
| `plan` | string, 1–40 | Sí | Id del plan: `essential`, `pro`, `free`… El mismo id siempre |
| `status` | string, 1–40 | Sí | Estado de la suscripción en Stripe: `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`. `free` si no tiene suscripción |
| `createdAt` | ISO 8601 o `null` | No | Alta de la cuenta |
| `lastActiveAt` | ISO 8601 o `null` | No | Último login o última petición autenticada, lo más reciente |
| `trialEndsAt` | ISO 8601 o `null` | No | Fin del trial, si aplica |
| `patientCount` | entero ≥ 0 | Sí | Pacientes activos del terapeuta (sin borrados ni purgados) |
| `sessionsLast30d` | entero ≥ 0 | Sí | Sesiones con fecha en los últimos 30 días |
| `billingPeriod` | `monthly`, `annual` o `null` | No | Periodo de cobro |
| `mrrAmount` | número ≥ 0, 2 decimales, o `null` | No | Lo que paga al mes después de cupones y descuentos (anual ÷ 12), en unidades de la moneda (pesos, no centavos). `0` si no paga |
| `currency` | 3 letras minúsculas o `null` | No | ISO 4217: `mxn`, `usd` |
| `currentPeriodEnd` | ISO 8601 o `null` | No | Fin del periodo pagado actual |
| `cancelAtPeriodEnd` | booleano | No | `true` si ya pidió cancelar al terminar el periodo |

- `generatedAt` y todas las fechas: ISO 8601 con zona (`Z` o `±hh:mm`).
- Incluye solo cuentas de terapeuta. Excluye pacientes, administradores internos y cuentas de prueba si hay forma de distinguirlas.
- Una cuenta que ya no viene en el snapshot se marca como baja en Ziora Ops. Un snapshot con `users: []` se ignora, porque casi siempre es un error.

### Cálculo y rendimiento

- `patientCount` y `sessionsLast30d`: `COUNT` agrupado por terapeuta en una o dos consultas. Sin N+1, sin cargar filas de pacientes y sin tocar columnas cifradas.
- Suscripciones: usa lo que la app ya guarda de Stripe (webhooks). Si falta un dato, léelo de Stripe en lote y con caché, nunca una llamada por usuario dentro de esta petición.
- Debe responder en menos de 30 segundos. Ziora Ops corta a los 60.

## 5. Endpoint 2 — aviso de "Ayuda y sugerencias"

### Cuándo

Cada vez que se crea una solicitud en "Ayuda y sugerencias". El envío corre en segundo plano y no bloquea al usuario.

### Petición (la hace ziora-api)

```http
POST {OPS_BASE_URL}/api/webhooks/ziora-help
Content-Type: application/json
X-Ops-Signature: <hex(HMAC-SHA256(OPS_BRIDGE_SECRET, cuerpo))>

{"id":"fb_7731","message":"No puedo exportar la nota en PDF","category":"bug","subject":"Exportar PDF","email":"psic.ana@ejemplo.com","appVersion":"2.14.0","pageUrl":"https://app.ziora-copilot.com/notas/123","createdAt":"2026-11-05T17:40:00Z"}
```

| Campo | Tipo | Obligatorio | Definición |
| --- | --- | --- | --- |
| `id` | string, 1–200 | Sí | Id estable de la solicitud. Reenviarlo no duplica el ticket |
| `message` | string, 1–5000 | Sí | Texto que escribió la persona |
| `category` | string ≤ 80 | No | Categoría elegida (bug, idea, pregunta…) |
| `subject` | string ≤ 200 | No | Asunto |
| `email` | correo | No | Quien la envió |
| `appVersion` | string ≤ 40 | No | Versión de la app |
| `pageUrl` | URL completa | No | Página donde estaba |
| `createdAt` | ISO 8601 con zona | No | Cuándo se creó |

- Solo estas llaves. Las opcionales sin valor se omiten.
- En el formulario de la app, agrega el texto "No incluyas datos de tus pacientes".

### Respuestas de Ziora Ops

| Código | Significado | Qué hacer |
| --- | --- | --- |
| `200` `{"ok":true,"ticket":"TKT-42"}` | Creado | Nada |
| `200` `{"ok":true,"ticket":"duplicado"}` | Ya existía ese id | Nada |
| `400` | Cuerpo inválido; el detalle viene en `error` | No reintentar; registrar el error |
| `401` | Firma inválida | No reintentar; revisar el secreto |
| `5xx` o error de red | Falla temporal | Reintentar |

### Reintentos y carga inicial

- Hasta 5 intentos con espera creciente (por ejemplo 1, 5, 30 y 120 minutos). Timeout de 10 segundos por intento.
- Agrega un comando o tarea para reenviar las solicitudes de los últimos 30 días (carga inicial). Es seguro porque Ziora Ops no duplica.

## 6. Endpoint 3 — aviso de demos y leads

### Cuándo

- Cuando se crea una demo o un lead desde la landing (lo que hoy entra con `LANDING_LEADS_TOKEN`).
- Cuando una demo se agenda, se reagenda o se cancela (calendario `DEMO_SHARED_CALENDAR_ID`).

### Petición (la hace ziora-api)

```http
POST {OPS_BASE_URL}/api/webhooks/demo
Content-Type: application/json
X-Ziora-Signature: <hex(HMAC-SHA256(OPS_DEMO_WEBHOOK_SECRET, cuerpo))>

{"id":"lead_5120","fullName":"Psic. Carolina Ruiz","email":"caro@ejemplo.com","whatsapp":"+52 33 1234 5678","patientsPerWeek":"15-25","teletherapy":"Sí","painPoint":"Las notas me quitan 2 horas al día","city":"Guadalajara","scheduledAt":"2026-11-06T17:00:00Z","status":"scheduled","marketingOptIn":true,"utm":{"utm_source":"instagram","utm_medium":"paid","utm_campaign":"demo-psicologos-gdl"}}
```

| Campo | Tipo | Obligatorio | Definición |
| --- | --- | --- | --- |
| `id` | string | Sí | Id estable del lead o demo. Es el mismo en todos sus avisos |
| `fullName` | string, 1–200 | Sí | Nombre |
| `email` | correo | Sí | Correo |
| `whatsapp` | string ≤ 40 | No | Teléfono con lada |
| `patientsPerWeek` | string ≤ 40 | No | Respuesta del formulario, tal cual |
| `teletherapy` | string ≤ 40 | No | Respuesta del formulario, tal cual |
| `painPoint` | string ≤ 300 | No | "¿Qué es lo que más te quita tiempo?" |
| `city` | string ≤ 80 | No | Ciudad como la escribió la persona |
| `scheduledAt` | ISO 8601 con zona | No | Fecha y hora de la demo. Sin este campo, la demo entra como "Solicitada" |
| `status` | `scheduled`, `rescheduled`, `cancelled` | No | Ver tabla de abajo |
| `marketingOptIn` | booleano | No | `true` solo si la persona marcó la casilla de recibir correos. Sin casilla, omítelo |
| `utm` | objeto de strings | No | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` |

### Qué hace Ziora Ops con cada aviso

| Aviso | Resultado en Ziora Ops |
| --- | --- |
| Id nuevo | Crea la demo (Solicitada o Agendada) y crea o completa el contacto compartido con Event Ops |
| Mismo id con otra `scheduledAt` | Reagenda. Si estaba cancelada, la regresa a Agendada |
| Mismo id con `status: "cancelled"` | La marca perdida ("Canceló la demo") si seguía abierta. Si ya se realizó o pagó, no la toca |
| Mismo id sin cambios | No hace nada (`duplicate`) |
| Correo `@ziora-copilot.com` (pruebas del equipo) | No entra al pipeline; responde `200` con `skipped` para que no se reintente |

### UTM

Guarda los UTM de la URL cuando la persona llega a la landing (por ejemplo, en `sessionStorage` o en una cookie de primera parte) y mándalos con el lead.

### Respuestas de Ziora Ops

- `200` `{"ok":true,"result":"created|rescheduled|cancelled|duplicate|skipped","demoId":"…"}`
- `400`, `401` y `5xx`: igual que en el endpoint 2, con los mismos reintentos.

## 7. Pruebas mínimas en ziora-api

1. **Endpoint 1, firma:** firma válida da 200, firma inválida da 401 y una petición de hace 6 minutos da 401.
2. **Endpoint 1, contrato:** cada usuario tiene solo las llaves de la tabla, ningún campo de paciente aparece en la respuesta y los conteos coinciden con datos de prueba.
3. **Endpoints 2 y 3, firma:** la firma enviada coincide con `hex(HMAC-SHA256(secreto, cuerpo))` sobre los bytes exactos enviados.
4. **Endpoints 2 y 3, campos y reintentos:** las opcionales sin valor no aparecen en el JSON. Un 5xx se reintenta y un 4xx no.
5. **Endpoint 3, ciclo completo:** crear, reagendar y cancelar mandan el mismo `id`.

## 8. Entrega

1. Despliega primero en `ziora-api-staging`.
2. Comparte con Uriel:
   - las URLs de `/ops/snapshot` en staging y en producción;
   - una solicitud de ayuda de prueba;
   - una demo de prueba.
3. Uriel conecta Ziora Ops y confirma que los datos llegaron. Después se repite en producción.
