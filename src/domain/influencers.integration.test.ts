/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

async function setup() {
  const { db } = await import("@/db");
  const { users } = await import("@/db/shared");
  const { upsertContact } = await import("./contacts");
  const t = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const [u] = await db.insert(users).values({ email: `inf-${t}@ziora.test`, name: "Ale", role: "operator", active: true }).returning({ id: users.id });
  const actor = { userId: u.id, label: "Ale" };
  const mk = (kind: "psicologo" | "influencer", n: string) =>
    upsertContact(db, { name: "Ana", source: "instagram", tags: [], social: { platform: "instagram", handle: `${n}.${t}`.slice(0, 30), leadType: kind } });
  const inf = await mk("influencer", "inf");
  const psicologo = await mk("psicologo", "psi");
  return { db, t, actor, inf, psicologo };
}

async function linkAccount(db: Awaited<ReturnType<typeof setup>>["db"], contactId: string, t: string, sessions: number) {
  const { appUsers, contacts } = await import("@/db/schema");
  const uid = `inf-uid-${t}`;
  await db.insert(appUsers).values({ uid, email: `u-${t}@example.com`, plan: "free", status: "free", syncedAt: new Date(), sessionsTotal: sessions });
  await db.update(contacts).set({ appUserUid: uid }).where(eq(contacts.id, contactId));
}

const deal = { kind: "comision" as const, terms: "20 %", closedOn: "2026-11-20" };

describe.runIf(enabled)("influencer: opinión, etapas y acuerdo", () => {
  it("la opinión guarda el texto, deja nota entrante y pone la etapa", async () => {
    const { db, actor, inf } = await setup();
    const { recordOpinion } = await import("./influencers");
    const { contacts, contactActivities } = await import("@/db/schema");
    await recordOpinion(db, inf.id, "Le gustó el Copilot", actor);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, inf.id));
    expect(c.influencerOpinion).toBe("Le gustó el Copilot");
    expect(c.influencerStage).toBe("opinion_recibida");
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, inf.id));
    expect(acts.some((a) => a.type === "nota" && a.direction === "entrante" && a.summary.includes("Le gustó el Copilot"))).toBe(true);
  });

  it("las etapas solo aplican a un lead de tipo influencer", async () => {
    const { db, actor, psicologo } = await setup();
    const { recordOpinion, setInfluencerStage } = await import("./influencers");
    await expect(recordOpinion(db, psicologo.id, "x", actor)).rejects.toThrow(/influencer/);
    await expect(setInfluencerStage(db, psicologo.id, "quiere_promover", actor)).rejects.toThrow(/influencer/);
  });

  it("las etapas respetan las transiciones y quedan en el historial", async () => {
    const { db, actor, inf } = await setup();
    const { setInfluencerStage } = await import("./influencers");
    const { contacts, contactActivities } = await import("@/db/schema");
    await setInfluencerStage(db, inf.id, "no_promueve", actor);
    await setInfluencerStage(db, inf.id, "quiere_promover", actor);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, inf.id));
    expect(c.influencerStage).toBe("quiere_promover");
    const acts = await db.select().from(contactActivities).where(and(eq(contactActivities.contactId, inf.id), eq(contactActivities.type, "cambio_estado")));
    expect(acts.length).toBe(2);
    await expect(setInfluencerStage(db, inf.id, "quiere_promover", actor)).rejects.toThrow(/mover/);
  });

  it("cerrar un acuerdo con alguien que no usa Ziora exige marcarlo a propósito", async () => {
    const { db, actor, inf } = await setup();
    const { closeDeal, setInfluencerStage } = await import("./influencers");
    const { contacts, contactActivities, influencerDeals, socialLinks } = await import("@/db/schema");
    await setInfluencerStage(db, inf.id, "quiere_promover", actor);
    await expect(closeDeal(db, inf.id, deal, actor)).rejects.toThrow(/no usa Ziora/);
    // El rechazo no deja nada a medias.
    expect((await db.select().from(influencerDeals).where(eq(influencerDeals.contactId, inf.id))).length).toBe(0);
    const r = await closeDeal(db, inf.id, { ...deal, overrideNoUse: true }, actor);
    const [d] = await db.select().from(influencerDeals).where(eq(influencerDeals.contactId, inf.id));
    expect(d.noUseOverride).toBe(true);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, inf.id));
    expect(c.influencerStage).toBe("acuerdo_cerrado");
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, inf.id));
    expect(acts.some((a) => a.summary.includes("Acuerdo cerrado sin uso de Ziora"))).toBe(true);
    const [l] = await db.select().from(socialLinks).where(and(eq(socialLinks.contactId, inf.id), eq(socialLinks.kind, "promocion")));
    expect(l.code).toBe(r.promoCode);
  });

  it("con cuenta ligada y una sesión el acuerdo se cierra sin excepción y crea la liga de promoción", async () => {
    const { db, t, actor, inf } = await setup();
    const { closeDeal, setInfluencerStage } = await import("./influencers");
    const { influencerDeals, socialLinks } = await import("@/db/schema");
    const { ensureInviteLink } = await import("./social-links");
    await linkAccount(db, inf.id, t, 1);
    const invite = await ensureInviteLink(db, inf.id, null);
    await setInfluencerStage(db, inf.id, "quiere_promover", actor);
    const r = await closeDeal(db, inf.id, { ...deal, kind: "pago_contenido", notes: "Un reel" }, actor);
    const [d] = await db.select().from(influencerDeals).where(eq(influencerDeals.contactId, inf.id));
    expect(d).toMatchObject({ kind: "pago_contenido", terms: "20 %", notes: "Un reel", noUseOverride: false, closedBy: actor.userId, closedOn: "2026-11-20" });
    const [promo] = await db.select().from(socialLinks).where(and(eq(socialLinks.contactId, inf.id), eq(socialLinks.kind, "promocion")));
    expect(promo.code).toBe(r.promoCode);
    expect(promo.code).not.toBe(invite.code);
  });

  it("cerrar exige estar en «quiere promover» y términos escritos; repetir no crea otro acuerdo ni otra liga", async () => {
    const { db, t, actor, inf } = await setup();
    const { closeDeal, setInfluencerStage } = await import("./influencers");
    const { influencerDeals, socialLinks } = await import("@/db/schema");
    await linkAccount(db, inf.id, t, 2);
    await expect(closeDeal(db, inf.id, deal, actor)).rejects.toThrow(/quiere promover/);
    await setInfluencerStage(db, inf.id, "quiere_promover", actor);
    await expect(closeDeal(db, inf.id, { ...deal, terms: "  " }, actor)).rejects.toThrow(/términos/);
    const a = await closeDeal(db, inf.id, deal, actor);
    await expect(closeDeal(db, inf.id, deal, actor)).rejects.toThrow();
    expect((await db.select().from(influencerDeals).where(eq(influencerDeals.contactId, inf.id))).length).toBe(1);
    const links = await db.select().from(socialLinks).where(and(eq(socialLinks.contactId, inf.id), eq(socialLinks.kind, "promocion")));
    expect(links.length).toBe(1);
    expect(links[0].code).toBe(a.promoCode);
  });

  it("el tablero junta el uso propio con lo que trae la liga de promoción y no cuenta su propio registro", async () => {
    const { db, t, actor, inf } = await setup();
    const { closeDeal, setInfluencerStage, loadInfluencerBoard } = await import("./influencers");
    const { appUsers, planPrices } = await import("@/db/schema");
    const { ensureInviteLink } = await import("./social-links");
    await db.insert(planPrices).values({ plan: "pro", label: "Pro", priceMxn: 699, paying: true }).onConflictDoNothing();
    await linkAccount(db, inf.id, t, 3);
    const invite = await ensureInviteLink(db, inf.id, null);
    await setInfluencerStage(db, inf.id, "quiere_promover", actor);
    const { promoCode } = await closeDeal(db, inf.id, deal, actor);
    const { socialLinks } = await import("@/db/schema");
    const [promo] = await db.select().from(socialLinks).where(eq(socialLinks.code, promoCode));
    const mkUser = (n: string, o: object) => db.insert(appUsers).values({ uid: `bu-${n}-${t}`, email: `${n}-${t}@example.com`, plan: "free", status: "free", syncedAt: new Date(), ...o });
    await db.update(appUsers).set({ socialLinkId: invite.id }).where(eq(appUsers.uid, `inf-uid-${t}`)); // su propio registro por su invitación
    await mkUser("a", { socialLinkId: promo.id });
    await mkUser("b", { socialLinkId: promo.id, plan: "pro", status: "active", mrrCents: 69900, currency: "mxn" });
    await mkUser("c", { socialLinkId: invite.id });
    await mkUser("d", { socialLinkId: promo.id, isTest: true });
    const row = (await loadInfluencerBoard(db)).find((r) => r.contactId === inf.id)!;
    expect(row).toMatchObject({ own: { registered: true, sessionsTotal: 3 }, promo: { code: promoCode, signups: 2, paying: 1 }, invitedExtra: 1, deal: { kind: "comision" } });
  });

  it("un influencer con acuerdo que no usa Ziora sale marcado", async () => {
    const { db, actor, inf } = await setup();
    const { closeDeal, setInfluencerStage, loadInfluencerBoard } = await import("./influencers");
    await setInfluencerStage(db, inf.id, "quiere_promover", actor);
    await closeDeal(db, inf.id, { ...deal, overrideNoUse: true }, actor);
    const row = (await loadInfluencerBoard(db)).find((r) => r.contactId === inf.id)!;
    expect(row.own.registered).toBe(false);
    expect(row.deal).not.toBeNull();
    expect(row.promo).toMatchObject({ signups: 0, paying: 0 });
  });
});
