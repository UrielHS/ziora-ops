"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contentChannelEnum, contentPillarEnum, contentStatusEnum, riskEnum } from "@/db/schema";
import * as content from "@/domain/content";
import { saveContentMix } from "@/domain/content-mix";
import { notifyTeam } from "@/integrations/notify";
import { formAction, type ActionState } from "@/lib/action";
import { LEGAL_CHECKLIST } from "@/lib/labels";
import { requirePermission } from "@/lib/session";

const fields = z.object({
  title: z.string().trim().min(3).max(200),
  pillar: z.enum(contentPillarEnum.enumValues),
  channels: z.array(z.enum(contentChannelEnum.enumValues)).min(1, "elige al menos un canal"),
  format: z.string().trim().min(2).max(40),
  status: z.enum(contentStatusEnum.enumValues).default("idea"),
  risk: z.enum(riskEnum.enumValues).default("low"),
  publishOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ownerId: z.uuid().optional(),
  copy: z.string().max(5000).optional(),
  sources: z.string().max(2000).optional(),
  assetUrl: z.url().optional(),
  publishedUrl: z.url().optional(),
  checks: z.array(z.string()).default([]),
  // Botón "Enviar a revisión" (en lugar de "Guardar").
  intent: z.enum(["save", "review"]).default("save"),
});

async function send(notices: content.Notice[]) {
  for (const n of notices) await notifyTeam(n.to, n.subject, n.lines, n.link);
}

async function save(id: string | null, d: z.infer<typeof fields>) {
  const { user } = await requirePermission("content.manage");
  const r = await content.savePiece(db, user, id, {
    title: d.title, pillar: d.pillar, channels: d.channels, format: d.format, status: d.status, risk: d.risk,
    publishOn: d.publishOn ?? null, ownerId: d.ownerId ?? null, copy: d.copy ?? null,
    assetUrl: d.assetUrl ?? null, publishedUrl: d.publishedUrl ?? null,
    sources: d.sources ? d.sources.split("\n").map((s) => s.trim()).filter(Boolean) : [],
    legalChecklistOk: d.checks.length === LEGAL_CHECKLIST.length,
  }, { requestReview: d.intent === "review" });
  await send(r.notices);
  revalidatePath("/", "layout");
  if (r.scheduledUnreviewed && r.sentToReview) return "Programada. Todo el equipo ya la ve en el calendario como \"Sin revisar\"; avisamos a CEO, director clínico y ventas.";
  if (r.sentToReview) return "Enviada a revisión: avisamos a CEO, director clínico y ventas.";
  if (r.resetReviews) return "Guardada. Como cambió el contenido, las aprobaciones anteriores se reiniciaron.";
  return "Guardada.";
}

const _createPiece = formAction(fields, (d) => save(null, d));
const _updatePiece = formAction(fields.extend({ id: z.uuid() }), ({ id, ...d }) => save(id, d));

const _reviewPiece = formAction(
  z.object({
    pieceId: z.uuid(),
    decision: z.enum(["approved", "changes_requested"]),
    comment: z.string().trim().max(2000).optional(),
  }),
  async (d) => {
    const { user } = await requirePermission("content.review");
    const r = await content.reviewPiece(db, user, d);
    await send(r.notices);
    revalidatePath("/", "layout");
    return r.message;
  },
);

const _createSuggestion = formAction(
  z.object({
    title: z.string().trim().min(3).max(200),
    idea: z.string().trim().min(10, "cuéntanos la idea con un poco más de detalle").max(3000),
    why: z.string().trim().max(1000).optional(),
    channel: z.enum(contentChannelEnum.enumValues).optional(),
    referenceUrl: z.url().optional(),
  }),
  async (d) => {
    const { user } = await requirePermission("content.suggest");
    await content.createSuggestion(db, user, d);
    revalidatePath("/", "layout");
    return "Sugerencia enviada a marketing.";
  },
);

const _decideSuggestion = formAction(
  z.discriminatedUnion("decision", [
    z.object({ id: z.uuid(), decision: z.literal("rejected"), note: z.string().trim().max(1000).optional() }),
    z.object({
      id: z.uuid(),
      decision: z.literal("accepted"),
      note: z.string().trim().max(1000).optional(),
      pillar: z.enum(contentPillarEnum.enumValues).default("psicoterapia_moderna"),
      channel: z.enum(contentChannelEnum.enumValues).default("instagram"),
      format: z.string().trim().min(2).max(40).default("carrusel"),
      publishOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  ]),
  async (d) => {
    const { user } = await requirePermission("suggestions.decide");
    const r = await content.decideSuggestion(db, user, d);
    await send(r.notices);
    revalidatePath("/", "layout");
    return d.decision === "accepted" ? "Aceptada: se creó la pieza y la tarea de publicación." : "Sugerencia descartada.";
  },
);

const pct = z.coerce.number().int().min(0).max(100);
const _saveMix = formAction(
  z.object({ education: pct, entertainment: pct, product: pct }),
  async (mix) => {
    const { user } = await requirePermission("content.manage");
    await saveContentMix(db, user.id, mix);
    revalidatePath("/content");
    return "Meta de la mezcla actualizada.";
  },
);

// Next exige que cada export de un archivo "use server" sea una función async declarada.
export async function createPiece(prev: ActionState, fd: FormData) {
  return _createPiece(prev, fd);
}
export async function updatePiece(prev: ActionState, fd: FormData) {
  return _updatePiece(prev, fd);
}
export async function reviewPiece(prev: ActionState, fd: FormData) {
  return _reviewPiece(prev, fd);
}
export async function createSuggestion(prev: ActionState, fd: FormData) {
  return _createSuggestion(prev, fd);
}
export async function decideSuggestion(prev: ActionState, fd: FormData) {
  return _decideSuggestion(prev, fd);
}
export async function saveMix(prev: ActionState, fd: FormData) {
  return _saveMix(prev, fd);
}
