/** Comunidades (Fase 1): lo que ve cada publicadora en /communities/publicar (cola de publicación, grupos por unirse, posts por atender). */
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { baseMessages, communities, communityMemberships, communityPosts, type Community } from "@/db/schema";
import { eligibilityFor, postEligibility } from "./community-posts";
import type { MembershipStatus } from "./communities";

/** Cupo semanal por publicadora (decisión de Chris, 11-nov-2026). Configurable. */
export const WEEKLY_POSTS_PER_PUBLISHER = 3;
const DAY = 86_400_000;

const PRIORITY_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };

export type QueueCandidate = {
  community: Pick<Community, "id" | "name" | "url" | "platform" | "priority" | "kind" | "status" | "promoPolicy">;
  membership: MembershipStatus | null;
  lastPublishedAt: Date | null;
  /** Veces que se ha usado cada mensaje (M1…) en este grupo. */
  usage: Record<string, number>;
  /** Post `planeado` de esta publicadora en este grupo (ya copiado, falta marcar publicado). */
  planned: { postId: string; code: string; text: string; key: string | null } | null;
};

export type PublishRow = QueueCandidate & { defaultKey: string };

/** El mensaje menos usado en el grupo; empata por orden de clave. */
export function leastUsedKey(keys: string[], usage: Record<string, number>): string {
  return [...keys].sort((a, b) => (usage[a] ?? 0) - (usage[b] ?? 0) || a.localeCompare(b, "es", { numeric: true }))[0];
}

/**
 * Cola de «Publicar»: solo grupos con membresía `unida` y elegibles. Los que ya tienen un post copiado
 * van primero y no gastan cupo nuevo; el resto va por prioridad A→C y, a igual prioridad, el que lleva más tiempo sin post.
 * `publishedThisWeek` = posts que esta persona publicó en los últimos 7 días.
 */
export function buildPublishQueue(
  candidates: QueueCandidate[], messageKeys: string[], publishedThisWeek: number, now: Date, quota = WEEKLY_POSTS_PER_PUBLISHER,
): { rows: PublishRow[]; remaining: number } {
  // Un post ya copiado tampoco se ofrece si dejó de ser elegible (p. ej. otra publicadora publicó en el grupo entretanto).
  const planned = candidates.filter((c) => c.planned && postEligibility(c.community, c.membership, c.lastPublishedAt, now).ok);
  const fresh = candidates.filter((c) => !c.planned && postEligibility(c.community, c.membership, c.lastPublishedAt, now).ok);
  fresh.sort((a, b) =>
    (PRIORITY_RANK[a.community.priority ?? ""] ?? 3) - (PRIORITY_RANK[b.community.priority ?? ""] ?? 3)
    || (a.lastPublishedAt?.getTime() ?? 0) - (b.lastPublishedAt?.getTime() ?? 0)
    || a.community.name.localeCompare(b.community.name, "es"));
  const remaining = Math.max(0, quota - publishedThisWeek - planned.length);
  const rows = [...planned, ...fresh.slice(0, remaining)].map((c) => ({
    ...c, defaultKey: c.planned?.key ?? leastUsedKey(messageKeys, c.usage),
  }));
  return { rows, remaining };
}

/**
 * Posts que cuentan contra el cupo: publicados en los últimos 7 días + planeados (generados en los últimos 7 días)
 * que siguen siendo elegibles. Es la misma regla que usa la cola de la pantalla, así que «Llevas» y el tope coinciden.
 */
export async function weeklyPostsUsed(db: Db, userId: string, now: Date = new Date(), excludeCommunityId?: string): Promise<number> {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const rows = await db.select({ communityId: communityPosts.communityId, status: communityPosts.status }).from(communityPosts)
    .where(and(
      eq(communityPosts.publisherId, userId),
      or(
        and(eq(communityPosts.status, "publicado"), gte(communityPosts.publishedAt, weekAgo)),
        and(eq(communityPosts.status, "planeado"), gte(communityPosts.createdAt, weekAgo)),
      ),
    ));
  let used = rows.filter((r) => r.status === "publicado").length;
  const plannedIn = [...new Set(rows.filter((r) => r.status === "planeado" && r.communityId !== excludeCommunityId).map((r) => r.communityId))];
  const counts = new Map<string, number>();
  for (const r of rows) if (r.status === "planeado") counts.set(r.communityId, (counts.get(r.communityId) ?? 0) + 1);
  for (const cid of plannedIn) {
    const [community] = await db.select().from(communities).where(eq(communities.id, cid)).limit(1);
    if (community && (await eligibilityFor(db, community, userId, now)).ok) used += counts.get(cid) ?? 0;
  }
  return used;
}

/** Cupo semanal del lado del servidor (la pantalla solo lo refleja). `replacingInCommunityId`: el planeado de ese grupo se va a reemplazar. */
export async function assertWeeklyQuota(db: Db, userId: string, now: Date = new Date(), replacingInCommunityId?: string): Promise<void> {
  const used = await weeklyPostsUsed(db, userId, now, replacingInCommunityId);
  if (used >= WEEKLY_POSTS_PER_PUBLISHER) throw new Error(`Ya llegaste a tus ${WEEKLY_POSTS_PER_PUBLISHER} posts de los últimos 7 días`);
}

export type PublisherView = {
  queue: PublishRow[]; remaining: number; publishedThisWeek: number; messageKeys: string[];
  toJoin: { community: Pick<Community, "id" | "name" | "url" | "platform" | "priority">; membership: MembershipStatus | null }[];
  toReply: { postId: string; code: string; communityName: string; postUrl: string | null; publishedAt: Date | null; clicks: number }[];
};

export async function loadPublisherView(db: Db, userId: string, now: Date = new Date()): Promise<PublisherView> {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const msgs = await db.select({ key: baseMessages.key }).from(baseMessages)
    .where(and(eq(baseMessages.status, "aprobado"), eq(baseMessages.isPost, true))).orderBy(baseMessages.key);
  const messageKeys = msgs.map((m) => m.key);

  const mine = await db.select().from(communityMemberships).where(eq(communityMemberships.userId, userId));
  const membershipOf = new Map(mine.map((m) => [m.communityId, m.status]));

  const groups = await db.select().from(communities)
    .where(and(eq(communities.kind, "grupo"), inArray(communities.status, ["aprobada", "activa"])));

  const joinedIds = groups.filter((g) => membershipOf.get(g.id) === "unida").map((g) => g.id);
  const last = joinedIds.length
    ? await db.select({ communityId: communityPosts.communityId, at: sql<Date | null>`max(${communityPosts.publishedAt})` }).from(communityPosts)
        .where(and(inArray(communityPosts.communityId, joinedIds), eq(communityPosts.status, "publicado"))).groupBy(communityPosts.communityId)
    : [];
  const lastAt = new Map(last.map((l) => [l.communityId, l.at ? new Date(l.at) : null]));
  const usageRows = joinedIds.length
    ? await db.select({ communityId: communityPosts.communityId, key: baseMessages.key, n: sql<number>`count(*)::int` }).from(communityPosts)
        .innerJoin(baseMessages, eq(baseMessages.id, communityPosts.baseMessageId))
        .where(and(inArray(communityPosts.communityId, joinedIds), inArray(communityPosts.status, ["planeado", "publicado", "espera_admin"])))
        .groupBy(communityPosts.communityId, baseMessages.key)
    : [];
  const usage = new Map<string, Record<string, number>>();
  for (const u of usageRows) usage.set(u.communityId, { ...usage.get(u.communityId), [u.key]: u.n });

  const plannedRows = await db.select({ p: communityPosts, key: baseMessages.key }).from(communityPosts)
    .leftJoin(baseMessages, eq(baseMessages.id, communityPosts.baseMessageId))
    .where(and(eq(communityPosts.publisherId, userId), eq(communityPosts.status, "planeado"))).orderBy(desc(communityPosts.createdAt));
  const plannedBy = new Map<string, QueueCandidate["planned"]>();
  for (const r of plannedRows) if (!plannedBy.has(r.p.communityId)) plannedBy.set(r.p.communityId, { postId: r.p.id, code: r.p.code, text: r.p.finalText ?? "", key: r.key });

  const published = await db.select({ p: communityPosts, name: communities.name }).from(communityPosts)
    .innerJoin(communities, eq(communities.id, communityPosts.communityId))
    .where(and(eq(communityPosts.publisherId, userId), eq(communityPosts.status, "publicado"), gte(communityPosts.publishedAt, weekAgo)))
    .orderBy(desc(communityPosts.publishedAt));

  const candidates: QueueCandidate[] = groups.filter((g) => membershipOf.get(g.id) === "unida").map((g) => ({
    community: g, membership: "unida" as const, lastPublishedAt: lastAt.get(g.id) ?? null, usage: usage.get(g.id) ?? {}, planned: plannedBy.get(g.id) ?? null,
  }));
  const { rows, remaining } = buildPublishQueue(candidates, messageKeys, published.length, now);
  const toJoin = groups
    .filter((g) => { const m = membershipOf.get(g.id) ?? null; return m === null || m === "por_solicitar" || m === "solicitud_enviada"; })
    .sort((a, b) => (PRIORITY_RANK[a.priority ?? ""] ?? 3) - (PRIORITY_RANK[b.priority ?? ""] ?? 3) || a.name.localeCompare(b.name, "es"))
    .map((g) => ({ community: g, membership: membershipOf.get(g.id) ?? null }));
  return {
    queue: rows, remaining, publishedThisWeek: published.length, messageKeys, toJoin,
    toReply: published.map((r) => ({ postId: r.p.id, code: r.p.code, communityName: r.name, postUrl: r.p.postUrl, publishedAt: r.p.publishedAt, clicks: r.p.clicks })),
  };
}

/** Motivo por el que no se puede generar un post en este grupo (null = sí se puede). Antes de la elegibilidad general, pide registrar la política. */
export function postBlockReason(
  c: { kind: "grupo" | "alianza"; status: string; promoPolicy: Community["promoPolicy"] },
  membership: MembershipStatus | null, lastPublishedAt: Date | null, now: Date,
): string | null {
  if (c.kind === "grupo" && (c.status === "aprobada" || c.status === "activa") && c.promoPolicy === "desconocido") {
    return "Registra primero la política de promoción";
  }
  const e = postEligibility(c, membership, lastPublishedAt, now);
  return e.ok ? null : e.reason;
}
