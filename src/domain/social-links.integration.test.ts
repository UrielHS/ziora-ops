/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { eq, inArray } from "drizzle-orm";
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

describe.runIf(enabled)("registro de la app ligado al lead de redes", () => {
  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  async function mk(opts: { promo?: boolean } = {}) {
    const { db } = await import("@/db");
    const { upsertContact } = await import("./contacts");
    const { ensureInviteLink, createPromoLink } = await import("./social-links");
    const { contacts } = await import("@/db/schema");
    const t = uniq();
    const lead = await upsertContact(db, { name: "Lead", source: "instagram", tags: [], social: { platform: "instagram", handle: `su.${t}`.slice(0, 30), leadType: "psicologo" } });
    let link = await ensureInviteLink(db, lead.id, null);
    if (opts.promo) {
      await db.update(contacts).set({ influencerStage: "acuerdo_cerrado" }).where(eq(contacts.id, lead.id));
      link = await createPromoLink(db, lead.id, null);
    }
    return { db, lead, link, t };
  }
  type DbT = Awaited<ReturnType<typeof mk>>["db"];
  const snap = (users: Record<string, unknown>[]) => ({ generatedAt: new Date().toISOString(), users: users.map((u) => ({ plan: "free", status: "free", patientCount: 0, ...u })) });
  // n = "1" es el más antiguo; "2" más nuevo
  const user = (t: string, n: string, code: string, extra: Record<string, unknown> = {}) => ({
    uid: `s${n}-${t}`, email: `s${n}-${t}@example.com`, createdAt: new Date(Date.now() - (10 - Number(n)) * 3600_000).toISOString(),
    attribution: { utm_source: "instagram", utm_medium: "redes", utm_campaign: "redes-psicologo-202611", utm_content: "invitacion", utm_term: code }, ...extra,
  });
  async function row(db: DbT, id: string) {
    const { contacts } = await import("@/db/schema");
    return (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
  }
  const acts = async (db: DbT, id: string) => {
    const { contactActivities } = await import("@/db/schema");
    return (await db.select().from(contactActivities).where(eq(contactActivities.contactId, id))).filter((a) => a.summary.startsWith("Se registró en Ziora"));
  };

  it("el primer registro con la liga personal se liga al lead; el segundo solo queda atribuido", async () => {
    const { db, lead, link, t } = await mk();
    const { applySnapshot } = await import("./app-users");
    const { appUsers, contactTags } = await import("@/db/schema");
    const u1 = user(t, "1", link.code), u2 = user(t, "2", link.code);
    // se mandan al revés: gana el registro más antiguo, no el primero de la lista
    await applySnapshot(db, snap([u2, u1]) as never);
    const c = await row(db, lead.id);
    expect(c.appUserUid).toBe(u1.uid);
    expect(c.email).toBe(u1.email);
    const au = await db.select().from(appUsers).where(inArray(appUsers.uid, [u1.uid, u2.uid]));
    expect(au.every((a) => a.socialLinkId === link.id)).toBe(true);
    expect((await acts(db, lead.id)).length).toBe(1);
    const tags = await db.select().from(contactTags).where(eq(contactTags.contactId, lead.id));
    expect(tags.some((x) => x.tag === "ziora_user")).toBe(true);
    // volver a sincronizar no duplica ni cambia nada
    await applySnapshot(db, snap([u1, u2]) as never);
    expect((await acts(db, lead.id)).length).toBe(1);
    expect((await row(db, lead.id)).appUserUid).toBe(u1.uid);
  });

  it("linkSocialSignups devuelve { linked, attributed } de los registros nuevos", async () => {
    const { db, lead, link, t } = await mk();
    const { linkSocialSignups } = await import("./social-links");
    const { appUsers } = await import("@/db/schema");
    const base = { plan: "free", status: "free", syncedAt: new Date(), attribution: { utm_medium: "redes", utm_term: link.code } };
    await db.insert(appUsers).values([
      { ...base, uid: `r1-${t}`, email: `r1-${t}@example.com`, signedUpAt: new Date(Date.now() - 7200_000) },
      { ...base, uid: `r2-${t}`, email: `r2-${t}@example.com`, signedUpAt: new Date(Date.now() - 3600_000) },
    ]);
    const r = await linkSocialSignups(db);
    expect(r.linked).toBeGreaterThanOrEqual(1);
    expect(r.attributed).toBeGreaterThanOrEqual(2);
    expect((await row(db, lead.id)).appUserUid).toBe(`r1-${t}`);
    expect((await acts(db, lead.id)).length).toBe(1);
  });

  it("una cuenta de prueba no gasta la liga", async () => {
    const { db, lead, link, t } = await mk();
    const { applySnapshot } = await import("./app-users");
    const { appUsers } = await import("@/db/schema");
    const test = user(t, "1", link.code, { email: `s1-${t}@ziora-copilot.com` });
    await applySnapshot(db, snap([test]) as never);
    const [au] = await db.select().from(appUsers).where(eq(appUsers.uid, test.uid));
    expect(au.socialLinkId).toBe(link.id);
    expect((await row(db, lead.id)).appUserUid).toBeNull();
    const real = user(t, "2", link.code);
    await applySnapshot(db, snap([test, real]) as never);
    expect((await row(db, lead.id)).appUserUid).toBe(real.uid);
  });

  it("si la landing cayó en el respaldo (medio comunidad) se liga igual por el código", async () => {
    const { db, lead, link, t } = await mk();
    const { applySnapshot } = await import("./app-users");
    const u = user(t, "1", link.code, { attribution: { utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611", utm_term: link.code } });
    await applySnapshot(db, snap([u]) as never);
    expect((await row(db, lead.id)).appUserUid).toBe(u.uid);
  });

  it("si el correo ya es de otro contacto no truena: liga por uid y lo anota", async () => {
    const { db, lead, link, t } = await mk();
    const { upsertContact } = await import("./contacts");
    const { applySnapshot } = await import("./app-users");
    const u = user(t, "1", link.code);
    const other = await upsertContact(db, { name: "Otro", email: u.email, source: "manual", tags: [] });
    await applySnapshot(db, snap([u]) as never);
    const c = await row(db, lead.id);
    expect(c.appUserUid).toBe(u.uid);
    expect(c.email).toBeNull();
    expect((c.details as Record<string, unknown>).correo_en_otro_lead).toBe(other.id);
  });

  it("un registro por la liga de promoción queda atribuido y nunca se liga como cuenta de nadie", async () => {
    const { db, lead, link, t } = await mk({ promo: true });
    const { applySnapshot } = await import("./app-users");
    const { appUsers } = await import("@/db/schema");
    expect(link.kind).toBe("promocion");
    const u = user(t, "1", link.code, { attribution: { utm_medium: "redes", utm_campaign: "redes-promo-202611", utm_content: "promo", utm_term: link.code } });
    await applySnapshot(db, snap([u]) as never);
    const [au] = await db.select().from(appUsers).where(eq(appUsers.uid, u.uid));
    expect(au.socialLinkId).toBe(link.id);
    expect((await row(db, lead.id)).appUserUid).toBeNull();
    expect((await acts(db, lead.id)).length).toBe(0);
  });
  it("si un usuario falla no tumba la sincronización: los demás se procesan y el fallo se cuenta", async () => {
    const { db, lead: leadA, link: linkA, t } = await mk();
    const { lead: leadB, link: linkB } = await mk();
    const { sql } = await import("drizzle-orm");
    const { linkSocialSignups } = await import("./social-links");
    const { appUsers } = await import("@/db/schema");
    const base = { plan: "free", status: "free", syncedAt: new Date() };
    const poisonUid = `poison-${t}`;
    await db.insert(appUsers).values([
      { ...base, uid: poisonUid, email: `poison-${t}@example.com`, signedUpAt: new Date(Date.now() - 7200_000), attribution: { utm_medium: "redes", utm_term: linkA.code } },
      { ...base, uid: `ok-${t}`, email: `ok-${t}@example.com`, signedUpAt: new Date(Date.now() - 3600_000), attribution: { utm_medium: "redes", utm_term: linkB.code } },
    ]);
    const fn = `ops.t7_poison_${t}`;
    const trg = `t7_poison_${t}`;
    await db.execute(sql.raw(`create function ${fn}() returns trigger language plpgsql as $$ begin if new.app_user_uid = '${poisonUid}' then raise exception 'boom'; end if; return new; end $$`));
    await db.execute(sql.raw(`create trigger ${trg} before update on ops.contacts for each row execute function ${fn}()`));
    const errSpy = (await import("vitest")).vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await linkSocialSignups(db);
      expect(r.failed).toBeGreaterThanOrEqual(1);
      expect((await row(db, leadB.id)).appUserUid).toBe(`ok-${t}`);
      expect((await row(db, leadA.id)).appUserUid).toBeNull();
      const logged = errSpy.mock.calls.flat().join(" ");
      expect(logged).toContain(poisonUid);
      expect(logged).not.toContain("@example.com");
    } finally {
      errSpy.mockRestore();
      await db.execute(sql.raw(`drop trigger ${trg} on ops.contacts`));
      await db.execute(sql.raw(`drop function ${fn}()`));
    }
  });
});
