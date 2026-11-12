/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

async function setup() {
  const { db } = await import("@/db");
  const { communities, communityCampaigns, communityMemberships, settings } = await import("@/db/schema");
  const { users } = await import("@/db/shared");
  const { seedComunidades } = await import("../../dev/seed-comunidades");
  const { createPost } = await import("./community-posts");
  const t = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const mkUser = async (name: string) => {
    const email = `${name.toLowerCase().replace(/\s/g, "")}-${t}@ziora.test`;
    return { email, id: (await db.insert(users).values({ email, name, role: "operator", active: true }).returning({ id: users.id }))[0].id };
  };
  const uriel = await mkUser("Uriel"), chris = await mkUser("Chris"), pau = await mkUser("Paulina Gomez"), euridice = await mkUser("Euridice");
  await seedComunidades(db, { owners: [uriel.email, chris.email] });
  await db.update(settings).set({ value: { ownerIds: [uriel.id, chris.id], last: -1 } }).where(eq(settings.key, "community_lead_rr"));
  await db.update(communityCampaigns).set({ active: false }).where(eq(communityCampaigns.active, true));
  await db.update(communityCampaigns).set({ active: true }).where(eq(communityCampaigns.slug, "prueba-1-mes-202611"));
  const [community] = await db.insert(communities).values({
    name: `Grupo ${t}`, platform: "facebook", url: `https://fb.com/${t}`, slug: `fb-grupo-${t}`.slice(0, 60), status: "aprobada", promoPolicy: "si",
  }).returning();
  await db.insert(communityMemberships).values({ communityId: community.id, userId: pau.id, status: "unida" });
  const actor = { userId: pau.id, label: "Paulina" };
  const post = await createPost(db, { communityId: community.id, baseMessageKey: "M1", publisherId: pau.id }, actor);
  return { db, t, uriel: uriel.id, chris: chris.id, pau: pau.id, euridice: euridice.id, community, post, actor };
}

describe.runIf(enabled)("comunidades: interesados y atribución", () => {
  it("dos interesados seguidos: Uriel y luego Chris; la publicadora nunca es dueña", async () => {
    const { db, t, uriel, chris, pau, community, post, actor } = await setup();
    const { contacts } = await import("@/db/schema");
    const { registerInterested } = await import("./community-leads");
    const a = await registerInterested(db, { postId: post.id, name: "Ana", email: `ana${t}@example.com`, kind: "psicologo" }, actor);
    const b = await registerInterested(db, { postId: post.id, name: "Beto", email: `beto${t}@example.com`, kind: "psicologo" }, actor);
    const d = await registerInterested(db, { postId: post.id, name: "Dani", email: `dani${t}@example.com`, kind: "psicologo" }, actor);
    expect([a.ownerId, b.ownerId, d.ownerId]).toEqual([uriel, chris, uriel]);
    expect([a.ownerId, b.ownerId]).not.toContain(pau);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
    expect(c).toMatchObject({ leadStatus: "nuevo", source: "facebook_group", communityId: community.id, communityPostId: post.id, registeredById: pau });
    expect(c.utm).toMatchObject({ utm_medium: "comunidad", utm_term: post.code });
    expect(c.leadRegisteredAt).not.toBeNull();
  });

  it("un lead que ya tenía dueño conserva dueño y fecha, y no gasta turno", async () => {
    const { db, t, uriel, euridice, post, actor } = await setup();
    const { contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { registerInterested } = await import("./community-leads");
    const email = `viejo${t}@example.com`;
    const before = new Date("2026-10-01T10:00:00Z");
    const { id } = await upsertContact(db, { name: "Viejo", email, source: "manual", tags: ["lead"], leadStatus: "contactado", ownerId: euridice, leadRegisteredAt: before });
    const r = await registerInterested(db, { postId: post.id, name: "Viejo", email, kind: "psicologo" }, actor);
    expect(r.contactId).toBe(id);
    expect(r.ownerId).toBe(euridice);
    expect(r.created).toBe(false);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.ownerId).toBe(euridice);
    expect(c.leadRegisteredAt?.getTime()).toBe(before.getTime());
    expect(c.registeredById).toBeNull();
    expect(c.leadStatus).toBe("contactado");
    // el siguiente nuevo le toca a quien seguía (Uriel), no a Chris
    const n = await registerInterested(db, { postId: post.id, name: "Nuevo", email: `nuevo${t}@example.com`, kind: "psicologo" }, actor);
    expect(n.ownerId).toBe(uriel);
  });

  it("solo con perfil crea el contacto y lo deduplica; sin ningún dato lanza", async () => {
    const { db, t, post, actor } = await setup();
    const { contacts } = await import("@/db/schema");
    const { registerInterested } = await import("./community-leads");
    await expect(registerInterested(db, { postId: post.id, name: "X", kind: "psicologo" }, actor)).rejects.toThrow("correo, teléfono o perfil");
    const profileUrl = `https://facebook.com/perfil.${t}`;
    const a = await registerInterested(db, { postId: post.id, name: "Perfil", profileUrl, kind: "psicologo" }, actor);
    expect(a.created).toBe(true);
    const b = await registerInterested(db, { postId: post.id, name: "Perfil", profileUrl, kind: "psicologo" }, actor);
    expect(b.created).toBe(false);
    expect(b.contactId).toBe(a.contactId);
    expect(b.ownerId).toBe(a.ownerId);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
    expect(c).toMatchObject({ website: profileUrl, email: null, leadStatus: "nuevo", communityPostId: post.id });
  });

  it("captura de /comunidad: lead con comunidad resuelta por utm_term y sin demo", async () => {
    const { db, t, community, post } = await setup();
    const { contacts, demoRequests } = await import("@/db/schema");
    const { ingestCommunityCapture, resolveAttribution } = await import("./community-leads");
    const email = `cap${t}@example.com`;
    const utm = { utm_source: "facebook", utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611", utm_content: community.slug, utm_term: post.code };
    const r = await ingestCommunityCapture(db, { fullName: "Capturada", email, utm });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
    expect(c).toMatchObject({ source: "landing_comunidad", leadStatus: "nuevo", communityPostId: post.id, communityId: community.id });
    expect(await db.select().from(demoRequests).where(eq(demoRequests.email, email))).toHaveLength(0);
    // sin código válido, cae al slug de la comunidad; el código se normaliza a minúsculas
    expect(await resolveAttribution(db, { utm_term: "zzzzzz", utm_content: community.slug })).toEqual({ communityId: community.id, postId: null });
    expect(await resolveAttribution(db, { utm_term: post.code.toUpperCase() })).toMatchObject({ postId: post.id });
  });

  it("una demo real con UTM guarda los UTM en el contacto y sigue siendo demo_form", async () => {
    const { db, t } = await setup();
    const { contacts, demoRequests } = await import("@/db/schema");
    const { ingestDemo } = await import("./demos");
    const email = `demo${t}@example.com`;
    const r = await ingestDemo(db, { fullName: "Demo Real", email, utm: { utm_source: "instagram", utm_campaign: "x" }, source: "ziora-copilot.com/demo", scheduledAt: new Date("2026-12-01T17:00:00Z") });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
    expect(c.source).toBe("demo_form");
    expect(c.utm).toMatchObject({ utm_source: "instagram" });
    expect(await db.select().from(demoRequests).where(eq(demoRequests.email, email))).toHaveLength(1);
  });

  it("el seed falla si un correo de --owners no existe", async () => {
    const { db } = await import("@/db");
    const { seedComunidades } = await import("../../dev/seed-comunidades");
    await expect(seedComunidades(db, { owners: [`nadie-${Date.now()}@ziora.test`] })).rejects.toThrow("No existe");
  });
});
