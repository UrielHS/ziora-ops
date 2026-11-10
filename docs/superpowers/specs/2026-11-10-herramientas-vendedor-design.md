# Herramientas del vendedor en Ziora Ops · diseño

**Fecha:** 10-nov-2026 · **Pide:** Chris (lista de 10 puntos del 9-nov, noche) · **Escribe:** Claude · **Estado:** decisiones por defecto de Claude donde Chris no las dio; marcadas con «(decisión Claude)». Chris revisa al volver.

Contexto: el CRM de leads (spec `2026-11-10-crm-leads-design.md`, fases 0-2 en prod) ya tiene embudo, dueños, Mi día y cadencias. Ahora cuatro personas venden (Chris, Eurídice, Rafa, Uriel) y cada una manda su propia liga de referido de la app, su calendario y, pronto, un código de descuento. Hace falta que Ops lo tenga a la mano desde la ficha del lead y que se pueda contar qué trae cada quien.

## 1. Metas

1. Desde la ficha de un lead, el vendedor copia en un clic: correo, teléfono, su liga de referido con UTM, su liga de calendario y su código de descuento.
2. Registrar en un clic «le mandé mi liga» y «ya lo está probando».
3. Marcar correo o teléfono incorrectos para que nadie (ni la cadencia) los vuelva a usar.
4. Ver de quién es cada lead en el kanban y filtrar por dueño.
5. Contar referidos (registros en la app) por vendedor.
6. Detalles: icono de Ziora en la pestaña; «Semana N de 12 del plan de 90 días» con la fecha real de inicio.

No metas: crear los códigos de descuento en Stripe (lo decide Chris: porcentaje y vigencia); conectar el calendario del vendedor por OAuth (solo se guarda la liga de reservas de Google Calendar); atribución por UTM dentro de la app (la app no persiste UTM hoy).

## 2. Modelo de datos (migración 0015, aditiva e idempotente)

- `ops.seller_profiles` (1 por usuario): `user_id` PK → `public.users.id` (cascade), `referral_url` text, `booking_url` text, `discount_code` text, `updated_at`. Cualquier usuario edita el suyo en Ajustes; quien tiene `team.manage` ve los de todos.
- `ops.contacts`: `email_invalid_at` timestamptz, `phone_invalid_at` timestamptz (null = válido). Se marcan y desmarcan desde la ficha con una actividad `nota` firmada por quien lo hizo («Marcó el correo como incorrecto»). (decisión Claude: no se borra el dato, solo se marca; así se puede corregir).
- `ops.app_users`: `referred_by_code` text (el código de referido con el que se registró el terapeuta; lo manda la app en el snapshot).

## 3. Comportamiento

### 3.1 Ligas del vendedor (puntos 1, 4, 8)
- Ajustes → tarjeta «Mi perfil de vendedor»: tres campos (liga de referido `https://ziora-copilot.com/r/XXXX`, liga de calendario `https://calendar.app.google/…`, código de descuento). Validación: URLs https; código en mayúsculas sin espacios.
- Ficha del lead → tarjeta «Mis ligas» (solo si el usuario actual tiene perfil; si no, aviso con liga a Ajustes): liga de referido **con UTM** `?utm_source=ziora_ops&utm_medium=vendedor&utm_campaign=<campaña>&utm_content=<código>`, donde campaña = `mtw-2026` si el lead viene de `sheet_import` y `leads` en otro caso (decisión Claude); liga de calendario; código de descuento. Cada una con botón Copiar.
- Código de referido = último segmento de `referral_url` (p. ej. `CHRIST-ERWK`); sirve para contar referidos (3.4).

### 3.2 Copiar y registrar (puntos 2, 3)
- «Datos de contacto»: botón Copiar junto a correo y teléfono (E.164 con «+»).
- «Registrar toque»: dos botones nuevos. **«Le mandé mi liga»** registra actividad `nota` saliente «Le mandé mi liga de prueba (referido)» con `meta.kind = referral_link`, y si el lead no tiene siguiente paso le pone «Ver si ya se registró» para dentro de 2 días (decisión Claude). **«Ya lo está probando»** pasa el lead a `en_trial` (a mano, con la regla de solo adelante; si ya está en trial o más, no hace nada y lo dice).

### 3.3 Correo o teléfono incorrecto (punto 5)
- Botones «Correo incorrecto» / «Teléfono incorrecto» en «Datos de contacto» (alternan: si ya está marcado, «Marcar como válido»). Badge rojo «Correo incorrecto» en ficha, tarjeta del kanban y Mi día.
- Cadencia: el paso de correo se omite con «correo marcado incorrecto» (misma ruta que «sin correo»); el de WhatsApp con «teléfono marcado incorrecto». Mi día no ofrece el botón de WhatsApp si el teléfono está marcado.
- La búsqueda y la importación no cambian.

### 3.4 De quién es cada lead y referidos (puntos 6, 9)
- Kanban: junto al avatar, el primer nombre del dueño; filtro «Dueño» (todos los usuarios activos + «Sin dueño») en la barra de filtros, como los demás filtros por query param (`dueno=<uuid>|ninguno`).
- Referidos: la app agrega `referredByCode` al snapshot de `opsSnapshot` (join `referrals` → `referral_codes.code` del terapeuta referido); Ops lo guarda en `app_users.referred_by_code`. Tarjeta «Referidos por vendedor» en `/leads`: por cada perfil con código, cuántos usuarios de la app se registraron con su código y cuántos pagan. Mientras la app no mande el campo, la tarjeta dice «La app aún no reporta referidos».
- El cambio en la app (ziora-gcp) va en su propia rama y PR; Ops tolera el campo ausente.

### 3.5 Detalles (puntos 7, 10)
- `src/app/icon.svg`: marca de Ziora (la del `safari-pinned-tab.svg` de la app) en blanco sobre un cuadro redondeado verde `#507060`. Next lo sirve como favicon.
- `GTM_START = 2026-11-09` y el saludo dice «Semana N de 12 del plan de 90 días» mientras N ≤ 12 (plan `docs/gtm/2026-11-09-plan-90-dias-equipo.md`). Las fases de metas d30/d60/d90 se recorren con la nueva fecha (decisión Claude; Chris confirma).

## 4. Preguntas para Chris (no bloquean)

1. Códigos de descuento: ¿qué porcentaje y vigencia por vendedor? Con eso los creo en Stripe (promotion codes) y los pego en cada perfil.
2. ¿Rafa, Eurídice y Uriel ya tienen liga de referido en la app? Si no, se genera desde su cuenta de Ziora (Referidos).
3. ¿Ok que los referidos se cuenten solo por código de referido (no por UTM)? Es lo único que la app guarda hoy.

## 5. Lo que queda al constructor

Nombres de componentes, orden visual dentro de las tarjetas, textos de ayuda breves en español, pruebas unitarias e integradas por función de dominio.
