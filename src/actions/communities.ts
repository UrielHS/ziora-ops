"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { baseMessages, communities, communityPosts } from "@/db/schema";
import { createCommunity, DISCARD_REASONS, PLATFORMS, reviewCommunity, setMembership, setPromoPolicy, type CommunityPlatform } from "@/domain/communities";
import { createPost, eligibilityFor, markDeletedByAdmin, markPublished, skipPost, updatePostText } from "@/domain/community-posts";
import { assertWeeklyQuota } from "@/domain/community-queue";
import { registerInterested } from "@/domain/community-leads";
import type { Actor } from "@/domain/leads";
import { formAction, type ActionState } from "@/lib/action";
import { requirePermission } from "@/lib/session";

const id = z.uuid();
const membership = z.enum(["por_solicitar", "solicitud_enviada", "unida", "rechazada", "nos_sacaron", "salio"]);
const policy = z.enum(["desconocido", "si", "no", "permiso_admin", "dias_especificos"]);
const messageKey = z.string().regex(/^M\d$/, "mensaje no válido");
/** Estado y edición cubren también los DM de redes (RP1–RP3, RI1–RI3); crear posts sigue siendo solo M#. */
const anyMessageKey = z.string().regex(/^(M\d|R[PI]\d)$/, "mensaje no válido");

async function actor(): Promise<{ a: Actor; userId: string }> {
  const { user } = await requirePermission("communities.operate");
  return { a: { userId: user.id, label: user.name }, userId: user.id };
}

/** Editar, publicar u omitir un post es solo de quien lo generó. */
async function assertOwnPost(postId: string, userId: string) {
  const [p] = await db.select({ publisherId: communityPosts.publisherId }).from(communityPosts).where(eq(communityPosts.id, postId)).limit(1);
  if (!p) throw new Error("Post no encontrado");
  if (p.publisherId !== userId) throw new Error("Este post lo generó otra persona");
}

function refresh() {
  revalidatePath("/communities", "layout");
}

const _create = formAction(z.object({
  name: z.string().trim().min(1, "falta el nombre").max(200), platform: z.enum(PLATFORMS as [CommunityPlatform, ...CommunityPlatform[]]),
  url: z.string().trim().min(1, "falta la liga").max(500), cityRegion: z.string().trim().max(120).optional(),
  recommendedBy: z.string().trim().max(120).optional(), notes: z.string().trim().max(1000).optional(),
}), async (d) => {
  const { a } = await actor();
  await createCommunity(db, d, a);
  refresh();
  return "Comunidad agregada: queda por revisar";
});

const _review = formAction(z.object({
  id, decision: z.enum(["aprobada", "descartada", "alianza"]), reason: z.enum(DISCARD_REASONS).optional(),
}), async (d) => {
  const { a } = await actor();
  if (d.decision === "descartada") {
    if (!d.reason) throw new Error("Indica el motivo del descarte");
    await reviewCommunity(db, d.id, { to: "descartada", reason: d.reason }, a);
  } else await reviewCommunity(db, d.id, { to: d.decision }, a);
  refresh();
  return d.decision === "aprobada" ? "Comunidad aprobada" : d.decision === "alianza" ? "Marcada como alianza" : "Comunidad descartada";
});

/** Siempre para la persona en sesión: nadie cambia la membresía de otra. */
const _membership = formAction(z.object({ communityId: id, status: membership }), async (d) => {
  const { userId } = await actor();
  await setMembership(db, d.communityId, userId, d.status);
  refresh();
  return "Membresía actualizada";
});

const _policy = formAction(z.object({ communityId: id, policy, rulesText: z.string().trim().max(4000).optional() }), async (d) => {
  const { a } = await actor();
  await setPromoPolicy(db, d.communityId, d.policy, d.rulesText ?? null, a);
  refresh();
  return "Política guardada";
});

const _createPost = formAction(z.object({ communityId: id, baseMessageKey: messageKey }), async (d) => {
  const { a, userId } = await actor();
  // Como «Copiar y abrir grupo»: si ya hay un planeado suyo en el grupo, se reutiliza (mismo mensaje) o se reemplaza (otro mensaje).
  const existing = await db.select({ p: communityPosts, key: baseMessages.key }).from(communityPosts)
    .leftJoin(baseMessages, eq(baseMessages.id, communityPosts.baseMessageId))
    .where(and(eq(communityPosts.communityId, d.communityId), eq(communityPosts.publisherId, userId), eq(communityPosts.status, "planeado")));
  if (existing.some((e) => e.key === d.baseMessageKey)) {
    const [community] = await db.select().from(communities).where(eq(communities.id, d.communityId)).limit(1);
    if (!community) throw new Error("Comunidad no encontrada");
    const elig = await eligibilityFor(db, community, userId);
    if (!elig.ok) throw new Error(elig.reason);
    refresh();
    return "Post generado";
  }
  await assertWeeklyQuota(db, userId, new Date(), d.communityId);
  const post = await createPost(db, { communityId: d.communityId, baseMessageKey: d.baseMessageKey, publisherId: userId }, a);
  for (const e of existing) if (e.p.id !== post.id) await skipPost(db, e.p.id, "Cambió de mensaje antes de publicar", a);
  refresh();
  return "Post generado";
});

const _updateText = formAction(z.object({ postId: id, text: z.string().trim().min(1, "falta el texto").max(6000) }), async (d) => {
  const { a, userId } = await actor();
  await assertOwnPost(d.postId, userId);
  await updatePostText(db, d.postId, d.text, a);
  refresh();
  return "Texto guardado";
});

const _published = formAction(z.object({ postId: id, postUrl: z.string().trim().max(500).optional() }), async (d) => {
  const { a, userId } = await actor();
  await assertOwnPost(d.postId, userId);
  await markPublished(db, d.postId, { postUrl: d.postUrl }, a);
  refresh();
  return "Post marcado como publicado";
});

const _skip = formAction(z.object({ postId: id, reason: z.string().trim().min(1, "indica el motivo").max(300) }), async (d) => {
  const { a, userId } = await actor();
  await assertOwnPost(d.postId, userId);
  await skipPost(db, d.postId, d.reason, a);
  refresh();
  return "Post omitido";
});

const _deleted = formAction(z.object({ postId: id }), async (d) => {
  const { a } = await actor();
  await markDeletedByAdmin(db, d.postId, a);
  refresh();
  return "Marcado como borrado por el admin: el grupo queda sin promoción";
});

const _interested = formAction(z.object({
  postId: id, name: z.string().trim().min(1, "falta el nombre").max(200), email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(), profileUrl: z.string().trim().max(500).optional(), note: z.string().trim().max(1000).optional(),
  kind: z.enum(["psicologo", "clinica", "asociacion"]).default("psicologo"),
}), async (d) => {
  const { a } = await actor();
  const r = await registerInterested(db, d, a);
  revalidatePath("/leads", "layout");
  revalidatePath("/contacts");
  refresh();
  return r.created ? "Interesado registrado y asignado" : "Esa persona ya estaba registrada: se conserva su dueño";
});

/** Solo dirección aprueba o retira los mensajes base. */
const _baseStatus = formAction(z.object({ key: anyMessageKey, status: z.enum(["borrador", "aprobado", "retirado"]) }), async (d) => {
  const { user } = await requirePermission("communities.approve_messages");
  const patch = d.status === "aprobado" ? { status: d.status, approvedBy: user.id, approvedAt: new Date() } : { status: d.status };
  const res = await db.update(baseMessages).set(patch).where(eq(baseMessages.key, d.key)).returning({ id: baseMessages.id });
  if (!res.length) throw new Error("Mensaje no encontrado");
  refresh();
  return "Mensaje actualizado";
});

/** Editar el texto de un DM de redes: quien opera puede, pero el mensaje vuelve a borrador y dirección debe aprobarlo de nuevo. */
const _baseBody = formAction(z.object({ key: z.string().regex(/^R[PI]\d$/, "mensaje no válido"), body: z.string().trim().min(1, "falta el texto").max(4000) }), async (d) => {
  await requirePermission("communities.operate");
  const [cur] = await db.select({ id: baseMessages.id, version: baseMessages.version }).from(baseMessages).where(eq(baseMessages.key, d.key)).limit(1);
  if (!cur) throw new Error("Mensaje no encontrado");
  await db.update(baseMessages).set({ body: d.body, version: cur.version + 1, status: "borrador", approvedBy: null, approvedAt: null }).where(eq(baseMessages.id, cur.id));
  refresh();
  return "Texto guardado; dirección debe aprobarlo de nuevo";
});

export async function createCommunityAction(prev: ActionState, fd: FormData) { return _create(prev, fd); }
export async function reviewCommunityAction(prev: ActionState, fd: FormData) { return _review(prev, fd); }
export async function setMembershipAction(prev: ActionState, fd: FormData) { return _membership(prev, fd); }
export async function setPromoPolicyAction(prev: ActionState, fd: FormData) { return _policy(prev, fd); }
export async function createPostAction(prev: ActionState, fd: FormData) { return _createPost(prev, fd); }
export async function updatePostTextAction(prev: ActionState, fd: FormData) { return _updateText(prev, fd); }
export async function markPublishedAction(prev: ActionState, fd: FormData) { return _published(prev, fd); }
export async function skipPostAction(prev: ActionState, fd: FormData) { return _skip(prev, fd); }
export async function markDeletedByAdminAction(prev: ActionState, fd: FormData) { return _deleted(prev, fd); }
export async function registerInterestedAction(prev: ActionState, fd: FormData) { return _interested(prev, fd); }
export async function setBaseMessageStatusAction(prev: ActionState, fd: FormData) { return _baseStatus(prev, fd); }
export async function updateBaseMessageBodyAction(prev: ActionState, fd: FormData) { return _baseBody(prev, fd); }

export type PrepareResult = { ok: true; postId: string; text: string; url: string } | { ok: false; error: string };

/**
 * «Copiar y abrir grupo»: deja listo el post de esta persona en el grupo (reutiliza el planeado si usa el mismo mensaje;
 * si cambió de mensaje, omite el anterior) y devuelve el texto con la liga corta y la URL del grupo.
 * No lanza: en producción Next oculta el mensaje de un error lanzado en una server action.
 */
export async function prepareCopyAndOpenAction(communityId: string, key: string): Promise<PrepareResult> {
  try {
    const { a, userId } = await actor();
    const cid = id.parse(communityId);
    const baseMessageKey = messageKey.parse(key);
    const [community] = await db.select().from(communities).where(eq(communities.id, cid)).limit(1);
    if (!community) return { ok: false, error: "Comunidad no encontrada" };
    const existing = await db.select({ p: communityPosts, key: baseMessages.key }).from(communityPosts)
      .leftJoin(baseMessages, eq(baseMessages.id, communityPosts.baseMessageId))
      .where(and(eq(communityPosts.communityId, cid), eq(communityPosts.publisherId, userId), eq(communityPosts.status, "planeado")));
    const same = existing.find((e) => e.key === baseMessageKey);
    let post;
    if (same) {
      // Reutilizar no salta las reglas: otra publicadora pudo publicar en el grupo desde que se generó.
      const elig = await eligibilityFor(db, community, userId);
      if (!elig.ok) return { ok: false, error: elig.reason };
      post = same.p;
    } else {
      // Si cambió de mensaje se crea primero el nuevo (puede fallar) y solo entonces se omite el anterior.
      await assertWeeklyQuota(db, userId, new Date(), cid);
      post = await createPost(db, { communityId: cid, baseMessageKey, publisherId: userId }, a);
    }
    for (const e of existing) if (e.p.id !== post.id) await skipPost(db, e.p.id, "Cambió de mensaje antes de publicar", a);
    refresh();
    return { ok: true, postId: post.id, text: post.finalText ?? "", url: community.url };
  } catch (err) {
    unstable_rethrow(err); // deja pasar redirect() y notFound() (p. ej. requirePermission)
    return { ok: false, error: err instanceof Error ? err.message : "No se pudo preparar el post" };
  }
}
