/** Comunidades (Fase 1): posts con código y liga corta, elegibilidad de publicación y resolución de clics. */
import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { appUsers, baseMessages, communities, communityCampaigns, communityMemberships, communityPosts, type CommunityPost } from "@/db/schema";
import { users } from "@/db/shared";
import type { CommunityKind, CommunityPlatform, MembershipStatus, PromoPolicy } from "./communities";
import type { Actor } from "./leads";

export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{6,8}$/;
const CODE_LENGTH = 6;
export const MIN_INTERVAL_DAYS = 21;
export const SEAT_BASE_KEY = "M6";

export type UtmKey = "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term";

export function newPostCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function shortLink(code: string): string {
  return `${process.env.LANDING_URL ?? "https://ziora-copilot.com"}/c/${code}`;
}

export function postUtm(code: string, community: { platform: CommunityPlatform; slug: string }, campaignSlug: string): Record<UtmKey, string> {
  return {
    utm_source: community.platform === "asociacion" ? "otro" : community.platform,
    utm_medium: "comunidad",
    utm_campaign: campaignSlug,
    utm_content: community.slug,
    utm_term: code,
  };
}

export function renderMessage(body: string, vars: { nombre: string; liga?: string; admin?: string }): string {
  let out = body.split("{nombre}").join(vars.nombre);
  if (vars.liga !== undefined) out = out.split("{liga}").join(vars.liga);
  if (vars.admin !== undefined) out = out.split("{admin}").join(vars.admin);
  return out;
}

export function postEligibility(
  c: { kind: CommunityKind; status: string; promoPolicy: PromoPolicy },
  membership: MembershipStatus | null,
  lastPublishedAt: Date | null,
  now: Date,
  minIntervalDays = MIN_INTERVAL_DAYS,
): { ok: true } | { ok: false; reason: string } {
  if (c.kind === "alianza") return { ok: false, reason: "Es una alianza: se aborda por persona, no con posts" };
  if (c.status !== "aprobada" && c.status !== "activa") return { ok: false, reason: "La comunidad no está aprobada para publicar" };
  if (c.promoPolicy === "permiso_admin") return { ok: false, reason: "Falta el permiso del admin" };
  if (c.promoPolicy !== "si") return { ok: false, reason: "No consta que el grupo permita promoción" };
  if (membership !== "unida") return { ok: false, reason: "Aún no eres miembro del grupo" };
  if (lastPublishedAt) {
    const days = (now.getTime() - lastPublishedAt.getTime()) / 86_400_000;
    if (days < minIntervalDays) return { ok: false, reason: `Ya se publicó hace ${Math.floor(days)} días; el mínimo es ${minIntervalDays}` };
  }
  return { ok: true };
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

export async function campaignSeatsUsed(db: Db, slug: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appUsers)
    .where(and(eq(appUsers.isTest, false), sql`${appUsers.attribution}->>'utm_campaign' = ${slug}`));
  return r?.n ?? 0;
}

/** Elegibilidad de una publicadora en un grupo ahora mismo: membresía propia e intervalo contando a todas las publicadoras. */
export async function eligibilityFor(
  db: Db,
  community: { id: string; kind: CommunityKind; status: string; promoPolicy: PromoPolicy },
  publisherId: string | null,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [m] = publisherId
    ? await db.select({ status: communityMemberships.status }).from(communityMemberships)
        .where(and(eq(communityMemberships.communityId, community.id), eq(communityMemberships.userId, publisherId))).limit(1)
    : [];
  const [last] = await db.select({ at: communityPosts.publishedAt }).from(communityPosts)
    .where(and(eq(communityPosts.communityId, community.id), eq(communityPosts.status, "publicado")))
    .orderBy(desc(communityPosts.publishedAt)).limit(1);
  return postEligibility(community, m?.status ?? null, last?.at ?? null, now);
}

export async function createPost(
  db: Db,
  input: { communityId: string; baseMessageKey: string; publisherId: string },
  actor: Actor,
  now: Date = new Date(),
): Promise<CommunityPost> {
  void actor;
  const campaigns = await db.select().from(communityCampaigns).where(eq(communityCampaigns.active, true));
  if (campaigns.length !== 1) throw new Error(campaigns.length ? "Hay más de una campaña activa" : "No hay campaña activa");
  const campaign = campaigns[0];

  const [community] = await db.select().from(communities).where(eq(communities.id, input.communityId)).limit(1);
  if (!community) throw new Error("Comunidad no encontrada");
  const [message] = await db.select().from(baseMessages).where(eq(baseMessages.key, input.baseMessageKey)).limit(1);
  if (!message || message.status !== "aprobado" || !message.isPost) throw new Error("El mensaje no está aprobado para publicar");
  const [publisher] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.publisherId)).limit(1);
  if (!publisher) throw new Error("Publicadora no encontrada");

  const elig = await eligibilityFor(db, community, input.publisherId, now);
  if (!elig.ok) throw new Error(elig.reason);

  if (message.key === SEAT_BASE_KEY && campaign.seatLimit != null && (await campaignSeatsUsed(db, campaign.slug)) >= campaign.seatLimit) {
    throw new Error(`M6 retirado: el cupo de ${campaign.seatLimit} ya se llenó`);
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newPostCode();
    const finalText = renderMessage(message.body, { nombre: firstName(publisher.name), liga: shortLink(code) });
    const [row] = await db.insert(communityPosts).values({
      code, campaignId: campaign.id, communityId: community.id, publisherId: input.publisherId, baseMessageId: message.id,
      aiDraft: null, finalText, status: "planeado",
    }).onConflictDoNothing({ target: communityPosts.code }).returning();
    if (row) return row;
  }
  throw new Error("No se pudo generar un código único");
}

async function loadPost(db: Db, postId: string): Promise<CommunityPost> {
  const [p] = await db.select().from(communityPosts).where(eq(communityPosts.id, postId)).limit(1);
  if (!p) throw new Error("Post no encontrado");
  return p;
}

/** Un post sin la liga no se puede atribuir nunca: ni se guarda ni se publica así. */
function assertHasLink(code: string, text: string | null) {
  if (!text || !text.includes(shortLink(code))) throw new Error("El texto debe incluir la liga del post");
}

export async function updatePostText(db: Db, postId: string, text: string, actor: Actor): Promise<void> {
  void actor;
  const p = await loadPost(db, postId);
  if (p.status !== "planeado" && p.status !== "espera_admin") throw new Error("Este post ya no se puede editar");
  assertHasLink(p.code, text);
  await db.update(communityPosts).set({ finalText: text, updatedAt: new Date() }).where(eq(communityPosts.id, postId));
}

export async function markPublished(db: Db, postId: string, opts: { postUrl?: string }, actor: Actor, now: Date = new Date()): Promise<void> {
  void actor;
  const p = await loadPost(db, postId);
  if (p.status !== "planeado" && p.status !== "espera_admin") throw new Error("Este post no se puede marcar como publicado");
  assertHasLink(p.code, p.finalText);
  // Otra publicadora pudo publicar en el grupo (o cambiar la política o la membresía) después de que este post se generó.
  const [community] = await db.select().from(communities).where(eq(communities.id, p.communityId)).limit(1);
  if (!community) throw new Error("Comunidad no encontrada");
  const elig = await eligibilityFor(db, community, p.publisherId, now);
  if (!elig.ok) throw new Error(elig.reason);
  await db.update(communityPosts).set({ status: "publicado", publishedAt: now, postUrl: opts.postUrl?.trim() || null, updatedAt: now }).where(eq(communityPosts.id, postId));
  await db.update(communities).set({ status: "activa", updatedAt: now }).where(and(eq(communities.id, p.communityId), eq(communities.status, "aprobada")));
  // Con este post el grupo entra en el intervalo mínimo: los planeados de otras publicadoras ya no son elegibles.
  await db.update(communityPosts).set({ status: "omitido", skipReason: "otra publicadora publicó", updatedAt: now })
    .where(and(
      eq(communityPosts.communityId, p.communityId), ne(communityPosts.id, postId),
      p.publisherId ? or(isNull(communityPosts.publisherId), ne(communityPosts.publisherId, p.publisherId)) : undefined,
      inArray(communityPosts.status, ["planeado", "espera_admin"]),
    ));
}

export async function skipPost(db: Db, postId: string, reason: string, actor: Actor): Promise<void> {
  void actor;
  if (!reason.trim()) throw new Error("Indica el motivo");
  const p = await loadPost(db, postId);
  if (p.status !== "planeado" && p.status !== "espera_admin") throw new Error("Este post no se puede omitir");
  await db.update(communityPosts).set({ status: "omitido", skipReason: reason.trim(), updatedAt: new Date() }).where(eq(communityPosts.id, postId));
}

export async function markDeletedByAdmin(db: Db, postId: string, actor: Actor): Promise<void> {
  void actor;
  const p = await loadPost(db, postId);
  if (p.status !== "publicado") throw new Error("Solo se puede marcar como borrado un post publicado");
  const now = new Date();
  await db.update(communityPosts).set({ status: "borrado_admin", updatedAt: now }).where(eq(communityPosts.id, postId));
  await db.update(communities).set({ status: "sin_promocion", updatedAt: now }).where(eq(communities.id, p.communityId));
}

/** Cuenta el clic solo si `count`; devuelve las 5 UTM del post o null si el código no existe. */
export async function resolvePostLink(db: Db, code: string, opts: { count: boolean }): Promise<{ utm: Record<UtmKey, string> } | null> {
  const cols = { communityId: communityPosts.communityId, campaignId: communityPosts.campaignId };
  // Solo cuenta clic un post publicado de una campaña; un planeado u omitido sigue redirigiendo pero no suma.
  if (opts.count) {
    await db.update(communityPosts).set({ clicks: sql`${communityPosts.clicks} + 1` })
      .where(and(eq(communityPosts.code, code), eq(communityPosts.status, "publicado"), isNotNull(communityPosts.campaignId)));
  }
  const rows = await db.select(cols).from(communityPosts).where(eq(communityPosts.code, code)).limit(1);
  const post = rows[0];
  if (!post?.campaignId) return null;
  const [community] = await db.select({ platform: communities.platform, slug: communities.slug }).from(communities).where(eq(communities.id, post.communityId)).limit(1);
  const [camp] = await db.select({ slug: communityCampaigns.slug }).from(communityCampaigns).where(eq(communityCampaigns.id, post.campaignId)).limit(1);
  if (!community || !camp) return null;
  return { utm: postUtm(code, community, camp.slug) };
}
