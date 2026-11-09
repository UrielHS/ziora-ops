# Secuencia «MTW 4 toques» · textos para aprobación

Cadencia para los leads individuales de Mexico Tech Week (panel 26-oct y taller 30-oct de 2026). Cuatro toques en dos semanas: dos correos que manda el sistema solo y dos WhatsApp que aparecen listos en «Mi día» para que el dueño del lead los mande con un clic.

**Estado: borrador de Claude, pendiente de aprobación de Chris.** Hasta que apruebe, la semilla no se corre en producción. Los textos viven en `dev/seed-secuencia-mtw.ts`; este documento es la copia legible. Si cambias uno, cambia el otro.

## Reglas que cumplen los textos

- Tutear, tono cercano, sin tecnicismos.
- Variables: `{{nombre}}` (primer nombre del lead) y `{{remitente}}` (primer nombre del dueño del lead en Ops; si no tiene dueño, «el equipo de Ziora»). Los correos llevan además `{{{baja}}}`, la liga de baja que exige la ley.
- Correos: menos de 120 palabras, un solo llamado a la acción (responder con día y hora).
- WhatsApp: 60 palabras o menos, texto plano, sin ligas (el enlace de WhatsApp ya lleva el texto; la liga de prueba se manda después, a mano).
- El toque 4 cierra con elegancia y lo dice: no volvemos a escribir.
- Ningún texto afirma cifras de ahorro de tiempo ni testimonios; solo lo que hace el producto.

## Calendario

| Toque | Día | Canal | Quién lo manda |
|---|---|---|---|
| 1 | 0 (el día que se enrola, a las 10:00 CDMX) | Correo | Sistema |
| 2 | 3 | WhatsApp | Dueño del lead, desde «Mi día» |
| 3 | 7 | Correo | Sistema |
| 4 | 14 | WhatsApp | Dueño del lead, desde «Mi día» |

Se detiene sola cuando el lead responde, agenda demo, entra a trial, paga, se marca perdido o se da de baja del correo. Si el WhatsApp del toque 2 lleva más de 7 días sin mandarse, se salta y sigue el toque 3.

## Toque 1 · Correo · día 0

**Plantilla:** `MTW · Toque 1 · Nos vimos en Mexico Tech Week`
**Asunto:** `{{nombre}}, nos vimos en Mexico Tech Week`

> Hola {{nombre}},
>
> Soy {{remitente}}, de Ziora. Coincidimos en Mexico Tech Week, en el panel y el taller de IA para terapeutas, y quería seguir la plática.
>
> Ziora escucha tu sesión y en minutos te deja la nota clínica, el plan de tratamiento y un resumen del caso listos para revisar y aprobar. El audio se borra en cuanto apruebas la nota y todo va cifrado.
>
> ¿Te late que te lo enseñe en una llamada de 15 minutos? Responde este correo con un día y hora que te acomoden y lo agendamos.
>
> Un abrazo,
> {{remitente}}
> Ziora
>
> Si prefieres no recibir más correos míos, [date de baja aquí]({{{baja}}}).

## Toque 2 · WhatsApp · día 3

> Hola {{nombre}}, soy {{remitente}} de Ziora. Te escribí por correo hace unos días: nos vimos en Mexico Tech Week, en el taller de IA para terapeutas. ¿Te late que te enseñe Ziora en 15 minutos? Tú dime día y hora y yo me acomodo.

## Toque 3 · Correo · día 7

**Plantilla:** `MTW · Toque 3 · 15 minutos para enseñarte Ziora`
**Asunto:** `15 minutos para enseñarte Ziora, {{nombre}}`

> Hola {{nombre}},
>
> Te escribo de nuevo porque sé lo que cuesta ponerse al día con las notas después de una semana de consulta.
>
> Con Ziora grabas la sesión, revisas la nota que te propone y la apruebas; la idea es devolverte horas cada semana y que el expediente quede completo. Hay cuenta gratuita para empezar, sin tarjeta.
>
> Si quieres verlo funcionando, respóndeme con un hueco de 15 minutos esta semana o la próxima. Si prefieres probarlo tú, dime y te mando la liga.
>
> Saludos,
> {{remitente}}
> Ziora
>
> Si prefieres no recibir más correos míos, [date de baja aquí]({{{baja}}}).

## Toque 4 · WhatsApp · día 14

> Hola {{nombre}}, soy {{remitente}} de Ziora. Este es mi último mensaje: no te vuelvo a escribir, pero aquí quedo. Si algún día quieres probar Ziora o verlo en 15 minutos, mándame un mensaje y lo armamos. Gracias por tu tiempo y mucho éxito con tu consulta.

## Cómo se siembra

Local (para verla en `/leads/secuencias`):

```bash
export $(grep -E "^DATABASE_URL" .env | tr -d '\r')
npx tsx dev/seed-secuencia-mtw.ts
```

Producción: solo con el OK de Chris a estos textos, con el túnel de Cloud SQL y siguiendo `docs/RUNBOOK-CRM-LEADS.md` §7. La semilla es idempotente: busca la secuencia por nombre y las plantillas por nombre; si ya existen, actualiza los textos y reescribe los pasos sin crear duplicados ni tocar enrollments.
