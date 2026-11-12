/** Influencers de redes: opinión, etapas y acuerdo cerrado (con su liga de promoción). */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db, Dbx } from "@/db";
import { appUsers, contacts, influencerDeals, planPrices, type LeadStatus } from "@/db/schema";
import { inNoCardTrial, isActive, isPaying, type Price } from "./app-users";
import { INFLUENCER_STAGE } from "@/lib/labels";
import { logActivity, type Actor } from "./leads";
import { createPromoLink, loadLinks } from "./social-links";
import type { SocialPlatform } from "./social-leads";
import { canMoveStage, usesZiora, type DealKind, type InfluencerStage } from "./social-shared";

export { canMoveStage, usesZiora, type InfluencerStage, type DealKind };

async function loadInfluencer(tx: Dbx, contactId: string) {
  const [c] = await tx
    .select({ stage: contacts.influencerStage, leadType: contacts.socialLeadType, appUserUid: contacts.appUserUid })
    .from(contacts).where(eq(contacts.id, contactId)).for("update").limit(1);
  if (!c) throw new Error("Lead no encontrado");
  if (c.leadType !== "influencer") throw new Error("Solo un lead de tipo influencer tiene etapas de influencer");
  return c;
}

/** Guarda lo que opinó del producto: nota entrante en el historial y, si no tenía etapa, pasa a «Opinión recibida». */
export async function recordOpinion(db: Db, contactId: string, text: string, actor: Actor): Promise<void> {
  const opinion = text.trim();
  if (!opinion) throw new Error("Escribe la opinión");
  await db.transaction(async (tx) => {
    const c = await loadInfluencer(tx, contactId);
    if (c.stage === "acuerdo_cerrado") throw new Error("El acuerdo ya está cerrado");
    const moves = c.stage !== "opinion_recibida" && canMoveStage(c.stage, "opinion_recibida");
    await tx.update(contacts).set({ influencerOpinion: opinion, ...(moves ? { influencerStage: "opinion_recibida" as const } : {}) }).where(eq(contacts.id, contactId));
    await logActivity(tx, {
      contactId, type: "nota", direction: "entrante", actor,
      summary: `Opinión del influencer: ${opinion}`, meta: { kind: "influencer_opinion" },
    });
  });
}

/** Mueve la etapa a «quiere promover» o «no promueve». Acuerdo cerrado solo se alcanza con closeDeal. */
export async function setInfluencerStage(db: Db, contactId: string, to: "quiere_promover" | "no_promueve", actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await loadInfluencer(tx, contactId);
    if (!canMoveStage(c.stage, to)) throw new Error("No se puede mover a esa etapa desde la actual");
    await tx.update(contacts).set({ influencerStage: to }).where(eq(contacts.id, contactId));
    await logActivity(tx, {
      contactId, type: "cambio_estado", actor,
      summary: `Influencer: ${c.stage ? INFLUENCER_STAGE[c.stage] : "Sin etapa"} → ${INFLUENCER_STAGE[to]}`,
      meta: { kind: "influencer_stage", from: c.stage, to },
    });
  });
}

/**
 * Cierra el acuerdo y crea la liga de promoción, todo en una transacción.
 * Exige estar en «quiere promover» y términos escritos. Si no usa Ziora (sin cuenta ligada viva con una sesión),
 * solo se cierra con `overrideNoUse`, y queda anotado en el historial.
 */
export async function closeDeal(
  db: Db, contactId: string,
  d: { kind: DealKind; terms: string; notes?: string; closedOn: string; overrideNoUse?: boolean },
  actor: Actor,
): Promise<{ promoCode: string }> {
  const terms = d.terms.trim();
  if (!terms) throw new Error("Escribe los términos del acuerdo");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.closedOn)) throw new Error("Fecha del acuerdo no válida");
  return db.transaction(async (tx) => {
    const c = await loadInfluencer(tx, contactId);
    if (c.stage !== "quiere_promover") throw new Error("Para cerrar el acuerdo el lead debe estar en «quiere promover»");
    const [account] = c.appUserUid
      ? await tx.select({ sessionsTotal: appUsers.sessionsTotal, removedAt: appUsers.removedAt }).from(appUsers).where(eq(appUsers.uid, c.appUserUid)).limit(1)
      : [];
    const uses = usesZiora(account);
    if (!uses && !d.overrideNoUse) throw new Error("Este influencer todavía no usa Ziora. Confirma que quieres cerrar aunque no lo use.");
    const override = !uses;
    await tx.insert(influencerDeals).values({
      contactId, kind: d.kind, terms, notes: d.notes?.trim() || null, noUseOverride: override, closedBy: actor.userId, closedOn: d.closedOn,
    });
    await tx.update(contacts).set({ influencerStage: "acuerdo_cerrado" }).where(eq(contacts.id, contactId));
    const link = await createPromoLink(tx, contactId, actor.userId);
    await logActivity(tx, {
      contactId, type: "cambio_estado", actor,
      summary: `Influencer: ${INFLUENCER_STAGE.quiere_promover} → ${INFLUENCER_STAGE.acuerdo_cerrado}`,
      meta: { kind: "influencer_stage", from: "quiere_promover", to: "acuerdo_cerrado", dealKind: d.kind },
    });
    if (override) {
      await logActivity(tx, {
        contactId, type: "sistema", actor, summary: "Acuerdo cerrado sin uso de Ziora",
        meta: { kind: "influencer_deal_no_use" },
      });
    }
    return { promoCode: link.code };
  });
}

type PromoUser = { status: string; plan: string; mrrCents: number | null; currency: string | null; trialKind: string | null; trialEndsAt: Date | null };

/** Registros que trajo una liga de promoción: cuántos, cuántos siguen en prueba (con o sin tarjeta) y cuántos pagan. */
export function promoStats(users: PromoUser[], prices: Price[], now: Date): { signups: number; inTrial: number; paying: number } {
  return {
    signups: users.length,
    inTrial: users.filter((u) => /trial/i.test(u.status) || inNoCardTrial(u, now)).length,
    paying: users.filter((u) => isPaying(u, prices)).length,
  };
}

export type InfluencerRow = {
  contactId: string; name: string; handle: string; platform: SocialPlatform; followers: string | null;
  leadStatus: LeadStatus | null; stage: InfluencerStage | null;
  own: { registered: boolean; active: boolean; sessionsTotal: number; notesTotal: number; paying: boolean };
  deal: { kind: string; terms: string; closedOn: string } | null;
  promo: { code: string; clicks: number; signups: number; inTrial: number; paying: number } | null;
  invitedExtra: number;
};

/**
 * Tablero de influencers: una consulta por tabla, nunca una por fila. Con acuerdo primero, luego por registros de su liga.
 * `promo.*` y `invitedExtra` excluyen cuentas de prueba, bajas y la propia cuenta del influencer.
 */
export async function loadInfluencerBoard(db: Db, now = new Date()): Promise<InfluencerRow[]> {
  const cs = await db
    .select({
      id: contacts.id, name: contacts.name, handle: contacts.socialHandle, platform: contacts.socialPlatform, followers: contacts.socialFollowers,
      leadStatus: contacts.leadStatus, stage: contacts.influencerStage, uid: contacts.appUserUid,
    })
    .from(contacts).where(eq(contacts.socialLeadType, "influencer"));
  if (!cs.length) return [];
  const ids = cs.map((c) => c.id);
  const uids = cs.map((c) => c.uid).filter((u): u is string => !!u);
  const links = await loadLinks(db, ids);
  const linkIds = [...links.values()].flatMap((l) => [l.invite?.id, l.promo?.id]).filter((x): x is string => !!x);
  const conds = [linkIds.length ? inArray(appUsers.socialLinkId, linkIds) : undefined, uids.length ? inArray(appUsers.uid, uids) : undefined].filter((x) => !!x);
  const [deals, prices, users] = await Promise.all([
    db.select().from(influencerDeals).where(inArray(influencerDeals.contactId, ids)),
    db.select().from(planPrices) as Promise<Price[]>,
    conds.length ? db.select().from(appUsers).where(or(...conds)) : Promise.resolve([]),
  ]);
  const dealBy = new Map(deals.map((d) => [d.contactId, d]));
  const byUid = new Map(users.map((u) => [u.uid, u]));
  const counted = users.filter((u) => !u.isTest && !u.removedAt);
  const rows = cs.map((c): InfluencerRow => {
    const own = c.uid ? byUid.get(c.uid) : undefined;
    const live = own && !own.removedAt ? own : undefined;
    const l = links.get(c.id);
    const promoUsers = l?.promo ? counted.filter((u) => u.socialLinkId === l.promo!.id && u.uid !== c.uid) : [];
    const d = dealBy.get(c.id);
    return {
      contactId: c.id, name: c.name, handle: c.handle ?? "", platform: (c.platform === "tiktok" ? "tiktok" : "instagram"), followers: c.followers,
      leadStatus: c.leadStatus, stage: c.stage,
      own: {
        registered: !!live, active: !!live && isActive(live.lastActiveAt, now),
        sessionsTotal: live?.sessionsTotal ?? 0, notesTotal: live?.notesTotal ?? 0, paying: !!live && isPaying(live, prices),
      },
      deal: d ? { kind: d.kind, terms: d.terms, closedOn: d.closedOn } : null,
      promo: l?.promo ? { code: l.promo.code, clicks: l.promo.clicks, ...promoStats(promoUsers, prices, now) } : null,
      invitedExtra: l?.invite ? counted.filter((u) => u.socialLinkId === l.invite!.id && u.uid !== c.uid).length : 0,
    };
  });
  return rows.sort((a, b) => Number(!!b.deal) - Number(!!a.deal) || (b.promo?.signups ?? 0) - (a.promo?.signups ?? 0) || a.name.localeCompare(b.name));
}
