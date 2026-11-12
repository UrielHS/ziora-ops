/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const actor = { userId: null, label: "prueba" };

async function setup(opts: { promoPolicy?: "si" | "desconocido"; members?: ("pau" | "ale")[] } = {}) {
  const { db } = await import("@/db");
  const { communities, communityCampaigns, communityMemberships } = await import("@/db/schema");
  const { users } = await import("@/db/shared");
  const { seedComunidades } = await import("../../dev/seed-comunidades");
  const t = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await seedComunidades(db);
  // Una sola campaña activa: las de otras pruebas (si las hubiera) no deben estorbar.
  await db.update(communityCampaigns).set({ active: false }).where(eq(communityCampaigns.active, true));
  await db.update(communityCampaigns).set({ active: true }).where(eq(communityCampaigns.slug, "prueba-1-mes-202611"));
  const mkUser = async (name: string) => (await db.insert(users).values({ email: `${name.toLowerCase()}-${t}@ziora.test`, name, role: "operator", active: true }).returning({ id: users.id }))[0].id;
  const pau = await mkUser("Paulina Gómez");
  const ale = await mkUser("Ale Ruiz");
  const [community] = await db.insert(communities).values({
    name: `Grupo ${t}`, platform: "facebook", url: `https://fb.com/${t}`, slug: `fb-grupo-${t}`.slice(0, 60), status: "aprobada", promoPolicy: opts.promoPolicy ?? "si",
  }).returning();
  for (const who of opts.members ?? ["pau", "ale"]) {
    await db.insert(communityMemberships).values({ communityId: community.id, userId: who === "pau" ? pau : ale, status: "unida" });
  }
  return { db, community, pau, ale, t };
}

describe.runIf(enabled)("comunidades: posts, liga y clics", () => {
  it("genera el post con código, liga y texto listo", async () => {
    const { db, community, pau } = await setup();
    const { createPost } = await import("./community-posts");
    const post = await createPost(db, { communityId: community.id, baseMessageKey: "M1", publisherId: pau }, actor);
    expect(post.code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
    expect(post.status).toBe("planeado");
    expect(post.finalText).toContain(`https://ziora-copilot.com/c/${post.code}`);
    expect(post.finalText).toContain("Soy Paulina");
    expect(post.finalText).not.toContain("{");
  });

  it("no crea posts con un mensaje no post (M0) ni en un grupo sin promoción confirmada", async () => {
    const a = await setup();
    const { createPost } = await import("./community-posts");
    await expect(createPost(a.db, { communityId: a.community.id, baseMessageKey: "M0", publisherId: a.pau }, actor)).rejects.toThrow("mensaje");
    const b = await setup({ promoPolicy: "desconocido" });
    await expect(createPost(b.db, { communityId: b.community.id, baseMessageKey: "M1", publisherId: b.pau }, actor)).rejects.toThrow();
  });

  it("el intervalo de 21 días cuenta a las dos publicadoras", async () => {
    const { db, community, pau, ale } = await setup();
    const { createPost, markPublished } = await import("./community-posts");
    const now = new Date();
    const p = await createPost(db, { communityId: community.id, baseMessageKey: "M1", publisherId: pau }, actor, now);
    await markPublished(db, p.id, {}, actor, now);
    await expect(createPost(db, { communityId: community.id, baseMessageKey: "M2", publisherId: ale }, actor, new Date(now.getTime() + 5 * 86_400_000))).rejects.toThrow("mínimo");
    const later = await createPost(db, { communityId: community.id, baseMessageKey: "M2", publisherId: ale }, actor, new Date(now.getTime() + 22 * 86_400_000));
    expect(later.finalText).toContain("trabajo en Ziora");
    expect(later.finalText).toContain("Soy Ale");
  });

  it("no deja guardar ni publicar un texto sin la liga", async () => {
    const { db, community, pau } = await setup();
    const { communityPosts } = await import("@/db/schema");
    const { createPost, updatePostText, markPublished } = await import("./community-posts");
    const post = await createPost(db, { communityId: community.id, baseMessageKey: "M5", publisherId: pau }, actor);
    await expect(updatePostText(db, post.id, "Hola, colegas, prueben Ziora", actor)).rejects.toThrow("liga");
    await expect(updatePostText(db, post.id, `Prueben Ziora https://ziora-copilot.com/c/otro12`, actor)).rejects.toThrow("liga");
    await updatePostText(db, post.id, `Mi versión: ${post.finalText}`, actor);
    // Aunque el texto guardado perdiera la liga por otra vía, publicar tampoco pasa.
    await db.update(communityPosts).set({ finalText: "sin liga" }).where(eq(communityPosts.id, post.id));
    await expect(markPublished(db, post.id, {}, actor)).rejects.toThrow("liga");
  });

  it("resolver cuenta el clic solo si count=true; código desconocido da null", async () => {
    const { db, community, pau } = await setup();
    const { communityPosts } = await import("@/db/schema");
    const { createPost, markPublished, resolvePostLink } = await import("./community-posts");
    const post = await createPost(db, { communityId: community.id, baseMessageKey: "M1", publisherId: pau }, actor);
    // planeado: redirige pero no cuenta clic
    expect(await resolvePostLink(db, post.code, { count: true })).not.toBeNull();
    expect((await db.select().from(communityPosts).where(eq(communityPosts.id, post.id)))[0].clicks).toBe(0);
    await markPublished(db, post.id, {}, actor);
    const r = await resolvePostLink(db, post.code, { count: true });
    await resolvePostLink(db, post.code, { count: false });
    const [row] = await db.select().from(communityPosts).where(eq(communityPosts.id, post.id));
    expect(row.clicks).toBe(1);
    expect(r?.utm).toEqual({ utm_source: "facebook", utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611", utm_content: community.slug, utm_term: post.code });
    expect(await resolvePostLink(db, "zzzzzz", { count: true })).toBeNull();
  });

  it("M6 se retira al llenarse el cupo", async () => {
    const { db, community, pau, t } = await setup();
    const { appUsers } = await import("@/db/schema");
    const { createPost, campaignSeatsUsed } = await import("./community-posts");
    const base = await campaignSeatsUsed(db, "prueba-1-mes-202611");
    const need = base < 20 ? 20 - base : 0; // lugares que faltan para llenar el cupo
    const mk = (i: number, isTest: boolean) => ({
      uid: `seat-${t}-${i}-${isTest}`, email: `seat-${t}-${i}-${isTest}@x.test`, plan: "free", status: "active", isTest, attribution: { utm_campaign: "prueba-1-mes-202611" },
    });
    // Las cuentas de prueba no ocupan lugar.
    await db.insert(appUsers).values([mk(0, true), mk(1, true)]);
    if (need > 1) await db.insert(appUsers).values(Array.from({ length: need - 1 }, (_, i) => mk(i + 10, false)));
    if (need > 0) {
      expect(await campaignSeatsUsed(db, "prueba-1-mes-202611")).toBe(19);
      expect((await createPost(db, { communityId: community.id, baseMessageKey: "M6", publisherId: pau }, actor)).id).toBeTruthy();
      await db.insert(appUsers).values(mk(99, false));
    }
    const other = await setup();
    await expect(createPost(db, { communityId: other.community.id, baseMessageKey: "M6", publisherId: other.pau }, actor)).rejects.toThrow("M6 retirado");
    // Los demás mensajes siguen disponibles.
    expect((await createPost(db, { communityId: other.community.id, baseMessageKey: "M1", publisherId: other.pau }, actor)).id).toBeTruthy();
  });

  it("publicar activa la comunidad; el borrado del admin la deja sin promoción", async () => {
    const { db, community, pau } = await setup();
    const { communities, communityPosts } = await import("@/db/schema");
    const { createPost, markPublished, markDeletedByAdmin, skipPost } = await import("./community-posts");
    const post = await createPost(db, { communityId: community.id, baseMessageKey: "M3", publisherId: pau }, actor);
    await markPublished(db, post.id, { postUrl: "https://fb.com/post/1" }, actor);
    let [c] = await db.select().from(communities).where(eq(communities.id, community.id));
    let [p] = await db.select().from(communityPosts).where(eq(communityPosts.id, post.id));
    expect(c.status).toBe("activa");
    expect(p).toMatchObject({ status: "publicado", postUrl: "https://fb.com/post/1" });
    expect(p.publishedAt).toBeInstanceOf(Date);
    await markDeletedByAdmin(db, post.id, actor);
    [c] = await db.select().from(communities).where(eq(communities.id, community.id));
    [p] = await db.select().from(communityPosts).where(eq(communityPosts.id, post.id));
    expect(c.status).toBe("sin_promocion");
    expect(p.status).toBe("borrado_admin");

    const s = await setup();
    const planned = await createPost(s.db, { communityId: s.community.id, baseMessageKey: "M4", publisherId: s.pau }, actor);
    await expect(skipPost(s.db, planned.id, "  ", actor)).rejects.toThrow("motivo");
    await skipPost(s.db, planned.id, "Hoy no hubo tiempo", actor);
    const [sk] = await s.db.select().from(communityPosts).where(eq(communityPosts.id, planned.id));
    expect(sk).toMatchObject({ status: "omitido", skipReason: "Hoy no hubo tiempo" });
  });

  it("si Ale publica en el grupo, el post planeado de Pau ya no se puede publicar y sale de su cola", async () => {
    const { db, community, pau, ale } = await setup();
    const { communities, communityMemberships, communityPosts } = await import("@/db/schema");
    const { createPost, markPublished } = await import("./community-posts");
    const { loadPublisherView, weeklyPostsUsed, assertWeeklyQuota, WEEKLY_POSTS_PER_PUBLISHER } = await import("./community-queue");
    const pauPost = await createPost(db, { communityId: community.id, baseMessageKey: "M1", publisherId: pau }, actor);
    const alePost = await createPost(db, { communityId: community.id, baseMessageKey: "M2", publisherId: ale }, actor);
    expect((await loadPublisherView(db, pau)).queue.map((r) => r.community.id)).toContain(community.id);

    await markPublished(db, alePost.id, {}, actor);

    // El post de Pau se omite solo al publicar Ale, y ya no se puede publicar.
    const [still] = await db.select().from(communityPosts).where(eq(communityPosts.id, pauPost.id));
    expect(still).toMatchObject({ status: "omitido", skipReason: "otra publicadora publicó" });
    await expect(markPublished(db, pauPost.id, {}, actor)).rejects.toThrow(/no se puede marcar/);
    expect((await loadPublisherView(db, pau)).queue.map((r) => r.community.id)).not.toContain(community.id);

    // También se revalida la política y la membresía al publicar.
    const s = await setup();
    const p = await createPost(s.db, { communityId: s.community.id, baseMessageKey: "M1", publisherId: s.pau }, actor);
    await s.db.update(communities).set({ promoPolicy: "no" }).where(eq(communities.id, s.community.id));
    await expect(markPublished(s.db, p.id, {}, actor)).rejects.toThrow(/promoción/);

    // Cupo semanal del lado del servidor: planeados y publicados de los últimos 7 días cuentan.
    const q = await setup();
    for (let i = 0; i < WEEKLY_POSTS_PER_PUBLISHER; i++) {
      const [other] = await q.db.insert(communities).values({
        name: `Extra ${i} ${q.t}`, platform: "facebook", url: `https://fb.com/extra${i}${q.t}`, slug: `fb-extra-${i}-${q.t}`.slice(0, 60), status: "aprobada", promoPolicy: "si",
      }).returning();
      await q.db.insert(communityMemberships).values({ communityId: other.id, userId: q.pau, status: "unida" });
      await assertWeeklyQuota(q.db, q.pau);
      await createPost(q.db, { communityId: other.id, baseMessageKey: "M1", publisherId: q.pau }, actor);
    }
    expect(await weeklyPostsUsed(q.db, q.pau)).toBe(WEEKLY_POSTS_PER_PUBLISHER);
    await expect(assertWeeklyQuota(q.db, q.pau)).rejects.toThrow(/últimos 7 días/);
    await expect(assertWeeklyQuota(q.db, q.ale)).resolves.toBeUndefined();
  });

  it("el cupo cuenta solo planeados elegibles y borrar por el admin exige post publicado", async () => {
    const { db, community, pau, ale } = await setup();
    const { communityPosts } = await import("@/db/schema");
    const { createPost, markDeletedByAdmin } = await import("./community-posts");
    const { weeklyPostsUsed } = await import("./community-queue");
    const planned = await createPost(db, { communityId: community.id, baseMessageKey: "M1", publisherId: pau }, actor);
    expect(await weeklyPostsUsed(db, pau)).toBe(1);
    await expect(markDeletedByAdmin(db, planned.id, actor)).rejects.toThrow(/publicado/);
    // Si otra publicadora publica sin pasar por markPublished (dato directo), el planeado de Pau ya no es elegible y no cuenta.
    const alePost = await createPost(db, { communityId: community.id, baseMessageKey: "M2", publisherId: ale }, actor);
    await db.update(communityPosts).set({ status: "publicado", publishedAt: new Date() }).where(eq(communityPosts.id, alePost.id));
    expect(await weeklyPostsUsed(db, pau)).toBe(0);
  });

  it("la semilla es idempotente", async () => {
    const { db } = await import("@/db");
    const { baseMessages, communityCampaigns } = await import("@/db/schema");
    const { seedComunidades, BASE_MESSAGES } = await import("../../dev/seed-comunidades");
    await seedComunidades(db);
    const second = await seedComunidades(db);
    expect(second).toMatchObject({ campaignCreated: false, messagesCreated: 0, messagesUpdated: BASE_MESSAGES.length });
    const keys = BASE_MESSAGES.map((m) => m.key);
    expect(await db.select().from(baseMessages).where(inArray(baseMessages.key, keys))).toHaveLength(BASE_MESSAGES.length);
    expect(await db.select().from(communityCampaigns).where(eq(communityCampaigns.slug, "prueba-1-mes-202611"))).toHaveLength(1);
  });
});
