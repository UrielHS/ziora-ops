/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const actor = { userId: null, label: "prueba" };

async function setup() {
  const { db } = await import("@/db");
  const { upsertContact } = await import("./contacts");
  const t = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const lead = await upsertContact(db, { name: "Ana", source: "instagram", tags: [], social: { platform: "instagram", handle: `lk.${t}`.slice(0, 30), leadType: "psicologo" } });
  return { db, lead };
}

describe.runIf(enabled)("ligas de redes: invitación, promoción y clic", () => {
  it("ensureInviteLink devuelve siempre la misma liga del lead", async () => {
    const { db, lead } = await setup();
    const { ensureInviteLink, SOCIAL_CODE_RE } = await import("./social-links");
    const a = await ensureInviteLink(db, lead.id, null);
    const b = await ensureInviteLink(db, lead.id, null);
    expect(b.id).toBe(a.id);
    expect(b.code).toBe(a.code);
    expect(a.kind).toBe("invitacion");
    expect(SOCIAL_CODE_RE.test(a.code)).toBe(true);
  });

  it("createPromoLink exige acuerdo cerrado y luego es idempotente", async () => {
    const { db, lead } = await setup();
    const { createPromoLink } = await import("./social-links");
    const { contacts } = await import("@/db/schema");
    await expect(createPromoLink(db, lead.id, null)).rejects.toThrow(/acuerdo/);
    await db.update(contacts).set({ influencerStage: "acuerdo_cerrado" }).where(eq(contacts.id, lead.id));
    const a = await createPromoLink(db, lead.id, null);
    const b = await createPromoLink(db, lead.id, null);
    expect(a.kind).toBe("promocion");
    expect(b.id).toBe(a.id);
  });

  it("resolver cuenta el clic solo con count y usa el tipo ACTUAL del lead", async () => {
    const { db, lead } = await setup();
    const { ensureInviteLink, resolveSocialLink, loadLinks } = await import("./social-links");
    const { setSocialLeadType } = await import("./social-leads");
    const link = await ensureInviteLink(db, lead.id, null);
    expect((await resolveSocialLink(db, link.code, { count: true }))!.utm.utm_campaign).toBe("redes-psicologo-202611");
    await setSocialLeadType(db, lead.id, "influencer", actor);
    const r = await resolveSocialLink(db, link.code, { count: false });
    expect(r!.utm).toMatchObject({ utm_campaign: "redes-influencer-202611", utm_source: "instagram", utm_term: link.code });
    expect(await resolveSocialLink(db, "zzzzzzz", { count: true })).toBeNull();
    const m = await loadLinks(db, [lead.id]);
    expect(m.get(lead.id)?.invite?.clicks).toBe(1);
    expect(m.get(lead.id)?.promo).toBeUndefined();
  });

  it("la ruta resuelve posts y ligas de redes; código desconocido → 404", async () => {
    const { db, lead } = await setup();
    const { ensureInviteLink } = await import("./social-links");
    const { communityPosts, communities, communityCampaigns } = await import("@/db/schema");
    const { seedComunidades } = await import("../../dev/seed-comunidades");
    await seedComunidades(db);
    process.env.COMMUNITY_LINK_SECRET = "s3cret";
    const { POST } = await import("@/app/api/community-links/resolve/route");
    const call = (code: string, auth = true) => POST(new Request("http://x/r", {
      method: "POST", headers: auth ? { authorization: "Bearer s3cret" } : {}, body: JSON.stringify({ code }),
    }));
    const link = await ensureInviteLink(db, lead.id, null);
    const t = `${Date.now()}`;
    const [camp] = await db.select().from(communityCampaigns).where(eq(communityCampaigns.slug, "prueba-1-mes-202611"));
    const [community] = await db.insert(communities).values({ name: `G ${t}`, platform: "facebook", url: `https://fb.com/${t}`, slug: `fb-rt-${t}`.slice(0, 60), status: "aprobada", promoPolicy: "si" }).returning();
    const code = `p${t.slice(-5)}`.replace(/[01ilo]/g, "x");
    await db.insert(communityPosts).values({ code, campaignId: camp.id, communityId: community.id, publisherId: null, finalText: "x", status: "planeado" });
    expect((await (await call(code)).json()).utm.utm_medium).toBe("comunidad");
    expect((await (await call(link.code)).json()).utm.utm_medium).toBe("redes");
    expect((await call("zzzzzzz")).status).toBe(404);
    expect((await call(link.code, false)).status).toBe(401);
  });
});
