/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

async function setup(withSocial = true) {
  const { db } = await import("@/db");
  const { upsertContact } = await import("./contacts");
  const t = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const lead = withSocial
    ? await upsertContact(db, { name: "Ana", source: "instagram", tags: [], social: { platform: "instagram", handle: `dm.${t}`.slice(0, 30), leadType: "psicologo" } })
    : await upsertContact(db, { name: "Sin redes", source: "manual", tags: [], email: `sr${t}@example.com` });
  return { db, lead, actor: { userId: null, label: "prueba" } };
}

async function state(db: Awaited<ReturnType<typeof setup>>["db"], id: string) {
  const { contacts, contactActivities } = await import("@/db/schema");
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
  return { c, dms: acts.filter((a) => (a.meta as { kind?: string }).kind === "social_dm") };
}

describe.runIf(enabled)("«Le escribí»: registrar el DM", () => {
  it("el primer «Le escribí» deja nota saliente, pasa a contactado y pone el seguimiento a 4 días", async () => {
    const { db, lead, actor } = await setup();
    const { recordDm } = await import("./social-dm");
    expect(await recordDm(db, lead.id, actor, new Date("2026-11-16T18:00:00Z"))).toEqual({ recorded: true, step: 1 });
    const { c, dms } = await state(db, lead.id);
    expect(c.leadStatus).toBe("contactado");
    expect(c.nextAction).toBe("Seguimiento 1 por DM");
    expect(c.nextActionOn).toBe("2026-11-20");
    expect(dms).toHaveLength(1);
    expect(dms[0].direction).toBe("saliente");
    expect(dms[0].meta).toMatchObject({ kind: "social_dm", step: 1, key: "RP1" });
    expect(dms[0].summary).toBe("DM 1 por Instagram");
  });

  it("un doble clic no cuenta dos DMs ni salta el paso", async () => {
    const { db, lead, actor } = await setup();
    const { recordDm, dmCounts } = await import("./social-dm");
    const t0 = new Date("2026-11-16T18:00:00Z");
    await recordDm(db, lead.id, actor, t0);
    expect(await recordDm(db, lead.id, actor, new Date(t0.getTime() + 5_000))).toEqual({ recorded: false, step: 1 });
    expect((await dmCounts(db, [lead.id])).get(lead.id)).toBe(1);
  });

  it("dos envíos simultáneos cuentan un solo DM", async () => {
    const { db, lead, actor } = await setup();
    const { recordDm, dmCounts } = await import("./social-dm");
    const t0 = new Date("2026-11-16T18:00:00Z");
    const rs = await Promise.all([recordDm(db, lead.id, actor, t0), recordDm(db, lead.id, actor, t0)]);
    expect(rs.filter((r) => r.recorded)).toHaveLength(1);
    expect((await dmCounts(db, [lead.id])).get(lead.id)).toBe(1);
  });

  it("segundo y tercer DM programan +7 y +14; el cuarto no se registra", async () => {
    const { db, lead, actor } = await setup();
    const { recordDm } = await import("./social-dm");
    await recordDm(db, lead.id, actor, new Date("2026-11-16T18:00:00Z"));
    expect(await recordDm(db, lead.id, actor, new Date("2026-11-20T18:00:00Z"))).toEqual({ recorded: true, step: 2 });
    let s = await state(db, lead.id);
    expect(s.c.nextAction).toBe("Último seguimiento por DM");
    expect(s.c.nextActionOn).toBe("2026-11-27");
    expect(await recordDm(db, lead.id, actor, new Date("2026-11-27T18:00:00Z"))).toEqual({ recorded: true, step: 3 });
    s = await state(db, lead.id);
    expect(s.c.nextAction).toBe("Sin respuesta tras 3 mensajes: decidir si se marca perdido");
    expect(s.c.nextActionOn).toBe("2026-12-11");
    expect(await recordDm(db, lead.id, actor, new Date("2026-12-11T18:00:00Z"))).toEqual({ recorded: false, step: null });
    expect((await state(db, lead.id)).dms).toHaveLength(3);
  });

  it("no retrocede a quien ya respondió", async () => {
    const { db, lead, actor } = await setup();
    const { recordDm } = await import("./social-dm");
    const { contacts } = await import("@/db/schema");
    await db.update(contacts).set({ leadStatus: "respondio" }).where(eq(contacts.id, lead.id));
    await recordDm(db, lead.id, actor, new Date("2026-11-16T18:00:00Z"));
    expect((await state(db, lead.id)).c.leadStatus).toBe("respondio");
  });

  it("dmsSentToday cuenta por persona y por día de CDMX", async () => {
    const { db, lead, actor } = await setup();
    const { recordDm, dmsSentToday } = await import("./social-dm");
    const { users } = await import("@/db/shared");
    const t = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const mk = async (n: string) => (await db.insert(users).values({ email: `${n}-${t}@ziora.test`, name: n, role: "operator", active: true }).returning({ id: users.id }))[0].id;
    const me = await mk("yo");
    const other = await mk("otra");
    // 23:30 del 16 en CDMX = 05:30Z del 17: cuenta para el 16, no para el 17
    await recordDm(db, lead.id, { userId: me, label: "yo" }, new Date("2026-11-17T05:30:00Z"));
    expect(await dmsSentToday(db, me, new Date("2026-11-17T18:00:00Z"))).toBe(0);
    expect(await dmsSentToday(db, me, new Date("2026-11-17T04:00:00Z"))).toBe(1);
    // el DM de otra persona (otro lead, otro día) no suma
    const { lead: lead2 } = await setup();
    await recordDm(db, lead2.id, { userId: other, label: "otra" }, new Date("2026-11-16T18:00:00Z"));
    expect(await dmsSentToday(db, me, new Date("2026-11-16T20:00:00Z"))).toBe(1);
    expect(await dmsSentToday(db, other, new Date("2026-11-16T20:00:00Z"))).toBe(1);
  });

  it("un contacto sin usuario de redes no acepta DM", async () => {
    const { db, lead, actor } = await setup(false);
    const { recordDm } = await import("./social-dm");
    await expect(recordDm(db, lead.id, actor)).rejects.toThrow(/redes/);
  });
});
