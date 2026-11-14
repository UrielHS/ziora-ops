"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { shortLink } from "@/domain/community-posts";
import { closeDeal, recordOpinion, setInfluencerStage } from "@/domain/influencers";
import type { Actor } from "@/domain/leads";
import { dmCounts, dmFor, dmLead, loadDmMessages, recordDm } from "@/domain/social-dm";
import { generateDm, DM_BIO_MAX, type DmAiResult } from "@/domain/social-dm-ai";
import { loadLinks } from "@/domain/social-links";
import { addContactChannel, setSocialLeadType } from "@/domain/social-leads";
import { formAction, type ActionState } from "@/lib/action";
import { requirePermission } from "@/lib/session";

const id = z.uuid();

async function actor(): Promise<Actor> {
  const { user } = await requirePermission("leads.manage");
  return { userId: user.id, label: user.name };
}

function refresh(leadId: string) {
  revalidatePath("/leads", "layout");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${leadId}`);
}

/** «Le escribí»: registra el DM que tocaba. Un doble clic no lo cuenta dos veces. */
const _recordDm = formAction(z.object({ id }), async (d) => {
  const r = await recordDm(db, d.id, await actor());
  refresh(d.id);
  if (r.recorded) return `DM ${r.step} registrado`;
  if (r.reason === "status") return "Este lead ya respondió o salió del seguimiento: no se registró el DM";
  return r.step ? `El DM ${r.step} ya estaba registrado` : "Ya se mandaron los 3 mensajes";
});

/** Agrega correo y/o teléfono a un lead que solo tenía su @. */
const _addContactChannel = formAction(
  z.object({ id, email: z.string().trim().pipe(z.email("correo válido").max(200)).optional(), phone: z.string().trim().max(40).optional() }),
  async (d) => {
    if (!d.email && !d.phone) throw new Error("Escribe un correo o un teléfono");
    const r = await addContactChannel(db, d.id, { email: d.email, phone: d.phone }, await actor());
    if (!r.ok) throw new Error("Ese correo o teléfono ya es de otro contacto.");
    refresh(d.id);
    if (r.kept.length) return `Ya tenía otro ${r.kept.join(" y otro ")}; lo anoté como alterno`;
    if (r.added) return r.unreadablePhone ? "Correo agregado; no se pudo leer el teléfono" : "Dato agregado";
    if (r.unreadablePhone) throw new Error("No se pudo leer el teléfono");
    return "Ya lo tenía";
  },
);

const _setSocialLeadType = formAction(z.object({ id, type: z.enum(["psicologo", "influencer"]) }), async (d) => {
  await setSocialLeadType(db, d.id, d.type, await actor());
  refresh(d.id);
  return "Tipo actualizado";
});

/** Lo que opinó el influencer del producto. */
const _recordOpinion = formAction(z.object({ id, opinion: z.string().trim().min(1, "Escribe la opinión").max(4000) }), async (d) => {
  await recordOpinion(db, d.id, d.opinion, await actor());
  refresh(d.id);
  return "Opinión guardada";
});

const _setInfluencerStage = formAction(z.object({ id, stage: z.enum(["quiere_promover", "no_promueve"]) }), async (d) => {
  await setInfluencerStage(db, d.id, d.stage, await actor());
  refresh(d.id);
  return "Etapa actualizada";
});

/** Cierra el acuerdo (quién lo cerró = la persona en sesión) y crea la liga de promoción. */
const _closeDeal = formAction(
  z.object({
    id,
    kind: z.enum(["comision", "pago_contenido", "otro"]),
    terms: z.string().trim().min(1, "Escribe los términos (monto o porcentaje)").max(500),
    notes: z.string().trim().max(2000).optional(),
    closedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
    overrideNoUse: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  }),
  async (d) => {
    await closeDeal(db, d.id, { kind: d.kind, terms: d.terms, notes: d.notes, closedOn: d.closedOn, overrideNoUse: d.overrideNoUse }, await actor());
    refresh(d.id);
    return "Acuerdo cerrado; ya tiene su liga de promoción";
  },
);

export async function recordDmAction(prev: ActionState, fd: FormData) { return _recordDm(prev, fd); }
export async function addContactChannelAction(prev: ActionState, fd: FormData) { return _addContactChannel(prev, fd); }
export async function setSocialLeadTypeAction(prev: ActionState, fd: FormData) { return _setSocialLeadType(prev, fd); }
export async function recordOpinionAction(prev: ActionState, fd: FormData) { return _recordOpinion(prev, fd); }
export async function setInfluencerStageAction(prev: ActionState, fd: FormData) { return _setInfluencerStage(prev, fd); }
export async function closeDealAction(prev: ActionState, fd: FormData) { return _closeDeal(prev, fd); }

// Tope por persona para «Generar mensaje» (cada clic es una llamada de pago a Gemini). En memoria por instancia: basta para frenar clics repetidos.
const DM_QUOTA = 30;
const dmCalls = new Map<string, number[]>();
function takeDmQuota(userId: string, now = Date.now()): boolean {
  const recent = (dmCalls.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= DM_QUOTA) return false;
  dmCalls.set(userId, [...recent, now]);
  return true;
}

/**
 * «Generar mensaje»: personaliza con IA el DM que toca. Todo se calcula aquí (paso, mensaje aprobado, liga),
 * el navegador solo manda el lead y la bio que pegó Ale. No escribe nada en la base.
 */
export async function generateDmAction(input: { id: string; bio?: string }): Promise<DmAiResult | { error: string }> {
  const parsed = z.object({ id, bio: z.string().max(DM_BIO_MAX * 2).optional() }).safeParse(input);
  if (!parsed.success) return { error: "Datos inválidos" };
  const { user } = await requirePermission("leads.manage");
  if (!takeDmQuota(user.id)) return { error: "Demasiados mensajes seguidos: espera un minuto" };
  const [c] = await db.select().from(contacts).where(eq(contacts.id, parsed.data.id)).limit(1);
  if (!c?.socialHandle) return { error: "Este lead no es de redes" };
  const [counts, links, messages] = await Promise.all([dmCounts(db, [c.id]), loadLinks(db, [c.id]), loadDmMessages(db)]);
  const invite = links.get(c.id)?.invite;
  if (!invite) return { error: "Abre la ficha para generar su liga" };
  const liga = shortLink(invite.code);
  const yo = user.name.trim().split(/\s+/)[0] ?? user.name;
  const lead = dmLead(c);
  const dm = dmFor(lead, counts.get(c.id) ?? 0, messages, { yo, liga });
  if (!dm) return { error: "Ya no toca mandarle DM" };
  if (!dm.text) return { error: "Este mensaje aún no está aprobado por dirección" };
  return generateDm({
    lead: {
      name: c.name, handle: c.socialHandle, platform: lead.socialPlatform === "tiktok" ? "TikTok" : lead.socialPlatform === "instagram" ? "Instagram" : "redes",
      leadType: c.socialLeadType ?? "psicologo", approach: c.approach, city: c.cityName, followers: c.socialFollowers,
    },
    step: dm.step, base: dm.text, liga, bio: parsed.data.bio,
  });
}
