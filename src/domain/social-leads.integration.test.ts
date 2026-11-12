/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

async function setup() {
  const { db } = await import("@/db");
  const t = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return { db, t, h: `psic.${t}`.slice(0, 30), actor: { userId: null, label: "Ale" } };
}

describe.runIf(enabled)("leads de redes: identidad por plataforma y usuario", () => {
  it("un lead existe solo con plataforma y usuario; el segundo upsert no lo duplica", async () => {
    const { db, h } = await setup();
    const { upsertContact } = await import("./contacts");
    const a = await upsertContact(db, { name: "Ana", source: "instagram", tags: ["lead"], leadStatus: "nuevo", social: { platform: "instagram", handle: h, leadType: "psicologo" } });
    const b = await upsertContact(db, { name: "Otra", source: "instagram", tags: [], social: { platform: "instagram", handle: h } });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const { contacts } = await import("@/db/schema");
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    expect(c).toMatchObject({ socialPlatform: "instagram", socialHandle: h, socialLeadType: "psicologo", socialProfileUrl: `https://www.instagram.com/${h}/` });
  });

  it("el mismo usuario en TikTok es otro lead", async () => {
    const { db, h } = await setup();
    const { upsertContact } = await import("./contacts");
    const a = await upsertContact(db, { name: "Ana", source: "instagram", tags: [], social: { platform: "instagram", handle: h } });
    const b = await upsertContact(db, { name: "Ana", source: "tiktok", tags: [], social: { platform: "tiktok", handle: h } });
    expect(b.created).toBe(true);
    expect(b.id).not.toBe(a.id);
  });

  it("sin nombre, el lead se llama @usuario", async () => {
    const { db, h } = await setup();
    const { upsertContact } = await import("./contacts");
    const { contacts } = await import("@/db/schema");
    const a = await upsertContact(db, { name: "", source: "instagram", tags: [], social: { platform: "instagram", handle: h.toUpperCase() } });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    expect(c.name).toBe(`@${h}`);
    expect(c.socialHandle).toBe(h);
  });

  it("sin correo, teléfono ni usuario sigue fallando", async () => {
    const { db } = await setup();
    const { upsertContact } = await import("./contacts");
    await expect(upsertContact(db, { name: "X", source: "manual", tags: [] })).rejects.toThrow(/correo, teléfono o usuario/);
    await expect(upsertContact(db, { name: "X", source: "manual", tags: [], social: { platform: "instagram", handle: "con espacio" } })).rejects.toThrow(/correo, teléfono o usuario/);
  });

  it("un lead que ya existía por correo recibe sus datos de redes sin perder dueño ni estado", async () => {
    const { db, t, h } = await setup();
    const { upsertContact } = await import("./contacts");
    const { contacts } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const [u] = await db.insert(users).values({ email: `eu-${t}@ziora.test`, name: "Eu", role: "operator", active: true }).returning({ id: users.id });
    const email = `viejo${t}@example.com`;
    const a = await upsertContact(db, { name: "Viejo", email, source: "manual", tags: ["lead"], leadStatus: "respondio", ownerId: u.id });
    const b = await upsertContact(db, { name: "Viejo", email, source: "instagram", tags: [], leadStatus: "nuevo", ownerId: null, social: { platform: "instagram", handle: h, followers: "12k" } });
    expect(b).toEqual({ id: a.id, created: false });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    expect(c).toMatchObject({ ownerId: u.id, leadStatus: "respondio", socialHandle: h, socialFollowers: "12k" });
  });

  it("addContactChannel agrega el correo; si ya es de otro contacto no lo toca y dice de quién", async () => {
    const { db, t, h, actor } = await setup();
    const { upsertContact } = await import("./contacts");
    const { addContactChannel } = await import("./social-leads");
    const { contacts } = await import("@/db/schema");
    const lead = await upsertContact(db, { name: "L", source: "instagram", tags: [], social: { platform: "instagram", handle: h } });
    const otroEmail = `otro${t}@example.com`;
    const otro = await upsertContact(db, { name: "O", email: otroEmail, source: "manual", tags: [] });
    expect(await addContactChannel(db, lead.id, { email: `Nuevo${t}@example.com` }, actor)).toEqual({ ok: true });
    expect(await addContactChannel(db, lead.id, { email: otroEmail }, actor)).toEqual({ ok: false, takenBy: otro.id });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, lead.id));
    expect(c.email).toBe(`nuevo${t}@example.com`);
    const [o] = await db.select().from(contacts).where(eq(contacts.id, otro.id));
    expect(o.email).toBe(otroEmail);
  });

  it("setSocialLeadType cambia el tipo", async () => {
    const { db, h, actor } = await setup();
    const { upsertContact } = await import("./contacts");
    const { setSocialLeadType } = await import("./social-leads");
    const { contacts } = await import("@/db/schema");
    const a = await upsertContact(db, { name: "L", source: "instagram", tags: [], social: { platform: "instagram", handle: h } });
    await setSocialLeadType(db, a.id, "influencer", actor);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    expect(c.socialLeadType).toBe("influencer");
  });
});
