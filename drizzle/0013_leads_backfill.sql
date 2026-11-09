-- Backfill del estado inicial de los leads a partir de etiquetas, usuarios de la app y demos. Idempotente y solo hacia adelante.
-- Orden del embudo: nuevo 0 · contactado 1 · respondio 2 · demo_agendada 3 · en_trial 4 · pago 5 · perdido (terminal, aparte).
UPDATE "ops"."contacts" c SET lead_status = 'nuevo', status_changed_at = now()
WHERE c.lead_status IS NULL
  AND EXISTS (SELECT 1 FROM "ops"."contact_tags" t WHERE t.contact_id = c.id AND t.tag = 'lead');--> statement-breakpoint
-- Usuarios de la app: trialing → en_trial; activo con MRR > 0 → pago (cuentas de prueba y borradas no cuentan).
WITH objetivo AS (
  SELECT c.id,
         CASE WHEN u.status = 'active' AND coalesce(u.mrr_cents, 0) > 0 THEN 'pago'
              WHEN u.status ILIKE '%trial%' THEN 'en_trial' END::"ops"."lead_status" AS nuevo_estado
  FROM "ops"."contacts" c
  JOIN "ops"."app_users" u ON lower(trim(u.email)) = c.email
  -- Solo quien ya es lead (etiqueta lead → nuevo en el paso anterior): el equipo y quien llegó solo a la app no entran al embudo.
  WHERE u.removed_at IS NULL AND u.is_test = false AND c.lead_status IS NOT NULL AND c.lead_status <> 'perdido'
)
UPDATE "ops"."contacts" c SET lead_status = o.nuevo_estado, status_changed_at = now()
FROM objetivo o
WHERE c.id = o.id AND o.nuevo_estado IS NOT NULL
  AND array_position(ARRAY['nuevo','contactado','respondio','demo_agendada','en_trial','pago'], o.nuevo_estado::text)
      > coalesce(array_position(ARRAY['nuevo','contactado','respondio','demo_agendada','en_trial','pago'], c.lead_status::text), 0);--> statement-breakpoint
-- Demos (la más reciente por contacto): scheduled/done → demo_agendada; trial → en_trial; paid → pago; solo hacia adelante.
WITH ultima AS (
  SELECT DISTINCT ON (d.contact_id) d.contact_id, d.stage, d.lost_reason
  FROM "ops"."demo_requests" d WHERE d.contact_id IS NOT NULL
  ORDER BY d.contact_id, d.created_at DESC
), objetivo AS (
  SELECT u.contact_id AS id,
         CASE u.stage WHEN 'scheduled' THEN 'demo_agendada' WHEN 'done' THEN 'demo_agendada'
                      WHEN 'trial' THEN 'en_trial' WHEN 'paid' THEN 'pago' END::"ops"."lead_status" AS nuevo_estado
  FROM ultima u
)
UPDATE "ops"."contacts" c SET lead_status = o.nuevo_estado, status_changed_at = now()
FROM objetivo o
WHERE c.id = o.id AND o.nuevo_estado IS NOT NULL AND c.lead_status IS NOT NULL AND c.lead_status <> 'perdido'
  AND array_position(ARRAY['nuevo','contactado','respondio','demo_agendada','en_trial','pago'], o.nuevo_estado::text)
      > coalesce(array_position(ARRAY['nuevo','contactado','respondio','demo_agendada','en_trial','pago'], c.lead_status::text), 0);--> statement-breakpoint
-- Demo perdida o sin asistir → perdido, solo si el lead sigue en trabajo (nuevo/contactado/respondio o sin estado).
WITH ultima AS (
  SELECT DISTINCT ON (d.contact_id) d.contact_id, d.stage, d.lost_reason
  FROM "ops"."demo_requests" d WHERE d.contact_id IS NOT NULL
  ORDER BY d.contact_id, d.created_at DESC
)
UPDATE "ops"."contacts" c
SET lead_status = 'perdido', lost_reason = coalesce(nullif(trim(u.lost_reason), ''), CASE u.stage WHEN 'no_show' THEN 'No asistió a la demo' ELSE 'Demo perdida' END),
    status_changed_at = now()
FROM ultima u
WHERE c.id = u.contact_id AND u.stage IN ('lost', 'no_show')
  AND c.lead_status IN ('nuevo', 'contactado', 'respondio');--> statement-breakpoint
-- Una actividad de sistema por lead para que el timeline no empiece vacío.
INSERT INTO "ops"."contact_activities" (contact_id, type, direction, actor_label, summary, meta)
SELECT c.id, 'sistema', 'ninguna', 'sistema', 'Estado inicial por backfill: ' || c.lead_status::text, '{"backfill":"0013"}'::jsonb
FROM "ops"."contacts" c
WHERE c.lead_status IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ops"."contact_activities" a WHERE a.contact_id = c.id AND a.meta->>'backfill' = '0013');
