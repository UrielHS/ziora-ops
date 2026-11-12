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
    expect(await addContactChannel(db, lead.id, { email: `Nuevo${t}@example.com` }, actor)).toEqual({ ok: true, added: true, unreadablePhone: false, kept: [] });
    expect(await addContactChannel(db, lead.id, { email: `nuevo${t}@example.com` }, actor)).toEqual({ ok: true, added: false, unreadablePhone: false, kept: [] });
    expect(await addContactChannel(db, lead.id, { phone: "abc" }, actor)).toEqual({ ok: true, added: false, unreadablePhone: true, kept: [] });
    expect(await addContactChannel(db, lead.id, { email: otroEmail }, actor)).toEqual({ ok: false, takenBy: otro.id });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, lead.id));
    expect(c.email).toBe(`nuevo${t}@example.com`);
    const [o] = await db.select().from(contacts).where(eq(contacts.id, otro.id));
    expect(o.email).toBe(otroEmail);
  });

  it("addContactChannel no pisa el correo ni el teléfono que el lead ya tenía: los anota como alternos", async () => {
    const { db, t, h, actor } = await setup();
    const { upsertContact } = await import("./contacts");
    const { addContactChannel } = await import("./social-leads");
    const { contacts, contactActivities } = await import("@/db/schema");
    const d4 = String(Math.floor(Math.random() * 9000) + 1000);
    const lead = await upsertContact(db, { name: "L", source: "instagram", tags: [], email: `orig${t}@example.com`, phone: `+52 55 ${d4}1234`, social: { platform: "instagram", handle: h } });
    const [before] = await db.select().from(contacts).where(eq(contacts.id, lead.id));
    const r = await addContactChannel(db, lead.id, { email: `Nuevo${t}@example.com`, phone: `+52 55 ${d4}4321` }, actor);
    expect(r).toEqual({ ok: true, added: false, unreadablePhone: false, kept: ["correo", "teléfono"] });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, lead.id));
    expect(c.email).toBe(`orig${t}@example.com`);
    expect(c.phoneE164).toBe(before.phoneE164);
    expect(c.details).toMatchObject({ correo_alterno: `nuevo${t}@example.com`, telefono_alterno: `5255${d4}4321` });
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, lead.id));
    expect(acts.some((a) => (a.meta as { kind?: string }).kind === "channel_alternate")).toBe(true);
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

  async function importSetup() {
    const base = await setup();
    const { users } = await import("@/db/shared");
    const mk = async (tag: string) => (await base.db.insert(users).values({ email: `${tag}-${base.t}@ziora.test`, name: tag, role: "operator", active: true }).returning({ id: users.id }))[0].id;
    const { parseSocialCsv, importSocialLeads } = await import("./social-leads");
    const h1 = `i1.${base.t}`.slice(0, 30), h2 = `i2.${base.t}`.slice(0, 30);
    const csv = "Nivel,Tipo,Plataforma,Usuario,Nombre,Enfoque,Ciudad,Seguidores,Dato de seguidores,Notas,Perfil\n" +
      `Micro,Creador,Instagram,@${h1},Uno,TCC,CDMX,98.8K,verificado,,\nNano,Clínica,TikTok,@${h2},Dos,,,12K,,,\n`;
    const { rows } = parseSocialCsv(csv, "influencers");
    return { ...base, mk, rows, h1, h2, importSocialLeads, parseSocialCsv };
  }

  it("importa con Ale como dueña, en nuevo, con su liga de invitación; la segunda corrida no crea nada", async () => {
    const { db, rows, mk, actor, importSocialLeads, h1, h2 } = await importSetup();
    const { contacts, socialLinks } = await import("@/db/schema");
    const { and, inArray } = await import("drizzle-orm");
    const ale = await mk("ale");
    expect(await importSocialLeads(db, rows, { ownerId: ale, actor })).toEqual({ created: 2, existing: 0, otherOwner: [] });
    expect(await importSocialLeads(db, rows, { ownerId: ale, actor })).toEqual({ created: 0, existing: 2, otherOwner: [] });
    const cs = await db.select().from(contacts).where(inArray(contacts.socialHandle, [h1, h2]));
    expect(cs).toHaveLength(2);
    for (const c of cs) {
      expect(c).toMatchObject({ ownerId: ale, leadStatus: "nuevo", socialLeadType: "influencer" });
      const links = await db.select().from(socialLinks).where(and(eq(socialLinks.contactId, c.id), eq(socialLinks.kind, "invitacion")));
      expect(links).toHaveLength(1);
    }
    expect(cs.find((c) => c.socialHandle === h2)).toMatchObject({ source: "tiktok", socialPlatform: "tiktok", socialTier: "nano" });
  });

  it("un lead que ya existía con otro dueño no se reasigna ni cambia de estado, y se reporta", async () => {
    const { db, rows, mk, actor, importSocialLeads, h1 } = await importSetup();
    const { upsertContact } = await import("./contacts");
    const { contacts } = await import("@/db/schema");
    const ale = await mk("ale"), eu = await mk("eu");
    const previo = await upsertContact(db, { name: "Previo", source: "instagram", tags: [], leadStatus: "respondio", ownerId: eu, social: { platform: "instagram", handle: `https://instagram.com/${h1.toUpperCase()}/?igsh=zzz` } });
    const r = await importSocialLeads(db, rows, { ownerId: ale, actor });
    expect(r).toEqual({ created: 1, existing: 1, otherOwner: [previo.id] });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, previo.id));
    expect(c).toMatchObject({ ownerId: eu, leadStatus: "respondio", socialFollowers: "98.8K", socialTier: "micro" });
  });

  it("el mismo usuario en las dos listas conserva el tipo de la primera", async () => {
    const { db, rows, mk, actor, importSocialLeads, parseSocialCsv, h1 } = await importSetup();
    const { contacts } = await import("@/db/schema");
    const ale = await mk("ale");
    await importSocialLeads(db, rows, { ownerId: ale, actor });
    const psi = parseSocialCsv(`Zona,Alcaldía / municipio,Tipo,Usuario,Nombre\nZ,Coyoacán,Psicólogo/a,@${h1},Uno\n`, "psicologos").rows;
    expect(await importSocialLeads(db, psi, { ownerId: ale, actor })).toEqual({ created: 0, existing: 1, otherOwner: [] });
    const [c] = await db.select().from(contacts).where(eq(contacts.socialHandle, h1));
    expect(c.socialLeadType).toBe("influencer");
  });

  it("un contacto que tenía el perfil en website se reconoce como el mismo", async () => {
    const { db, rows, mk, actor, importSocialLeads, h1 } = await importSetup();
    const { upsertContact } = await import("./contacts");
    const { contacts } = await import("@/db/schema");
    const ale = await mk("ale");
    const previo = await upsertContact(db, { name: "Previo", email: `p${h1}@example.com`, source: "manual", tags: [], website: `https://instagram.com/${h1.toUpperCase()}/` });
    const r = await importSocialLeads(db, rows.slice(0, 1), { ownerId: ale, actor });
    expect(r.created).toBe(0);
    expect(r.existing).toBe(1);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, previo.id));
    expect(c).toMatchObject({ socialPlatform: "instagram", socialHandle: h1, ownerId: ale });
  });
});
