import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ingestCommunityCapture } from "@/domain/community-leads";
import { applyWebhookDemo, isTeamEmail } from "@/domain/demos";
import { ingestSocialCapture } from "@/domain/social-links";
import { verifyHmac } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";

/**
 * Demos y leads que avisa ziora-api (HMAC-SHA256 con DEMO_WEBHOOK_SECRET en X-Ziora-Signature).
 * Mismo id = misma demo: se crea, se reagenda si cambia scheduledAt o se marca perdida con status "cancelled".
 * El calendario del CEO (/api/jobs/sync-demos) queda como respaldo. Contrato: docs/API-ZIORA-APP.md.
 */
const Payload = z.object({
  id: z.string().optional(), // id en el sistema de origen, para no duplicar
  fullName: z.string().min(1).max(200),
  email: z.email(),
  whatsapp: z.string().max(40).optional(),
  patientsPerWeek: z.string().max(40).optional(),
  teletherapy: z.string().max(40).optional(),
  painPoint: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  marketingOptIn: z.boolean().optional(), // casilla en el formulario; sin ella NO se agrega a campañas
  utm: z.record(z.string(), z.string()).optional(),
  status: z.enum(["scheduled", "rescheduled", "cancelled"]).optional(),
});

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyHmac(requireEnv("DEMO_WEBHOOK_SECRET"), raw, req.headers.get("x-ziora-signature"))) {
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Payload.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const p = parsed.data;
  // Pruebas del equipo (correo @ziora-copilot.com): se responden como "skipped" para que la app no reintente.
  if (isTeamEmail(p.email)) return NextResponse.json({ ok: true, result: "skipped", demoId: null, reason: "correo del equipo" });

  // Captura suave de /comunidad con UTM de redes (la visita viene de un DM): completa el lead de la liga.
  if (p.utm?.utm_medium === "redes" && !p.scheduledAt && !p.status) {
    await ingestSocialCapture(db, { fullName: p.fullName, email: p.email, utm: p.utm, note: p.painPoint });
    return NextResponse.json({ ok: true, result: "lead" });
  }

  // Captura suave de /comunidad: es un lead con atribución, no una demo.
  if (p.utm?.utm_medium === "comunidad" && !p.scheduledAt && !p.status) {
    await ingestCommunityCapture(db, { externalId: p.id, fullName: p.fullName, email: p.email, utm: p.utm, note: p.painPoint });
    return NextResponse.json({ ok: true, result: "lead" });
  }

  const r = await applyWebhookDemo(db, {
    externalId: p.id, fullName: p.fullName, email: p.email, whatsapp: p.whatsapp, patientsPerWeek: p.patientsPerWeek,
    teletherapy: p.teletherapy, painPoint: p.painPoint, city: p.city, scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
    marketingOptIn: p.marketingOptIn, utm: p.utm, source: "ziora-copilot.com/demo", raw: body as Record<string, unknown>,
    status: p.status,
  });
  return NextResponse.json({ ok: true, ...r });
}
