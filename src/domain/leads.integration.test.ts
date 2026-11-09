/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base con ambos schemas. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const actor = { userId: null, label: "prueba" };

describe.runIf(enabled)("leads: estados, actividades y toques", () => {
  it("un toque pasa nuevo→contactado y deja actividad; un avance no retrocede; perdido exige motivo", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { advanceLead, recordTouch, setLeadStatus } = await import("./leads");
    const t = Date.now();
    const { id } = await upsertContact(db, { name: "Lead Prueba", email: `lead${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });

    await recordTouch(db, id, "whatsapp", actor, "Primer mensaje");
    let [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("contactado");
    expect(c.lastContactAt).not.toBeNull();

    expect(await advanceLead(db, id, "pago", actor)).toBe(true);
    expect(await advanceLead(db, id, "en_trial", actor)).toBe(false);
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("pago");

    await expect(setLeadStatus(db, id, "perdido", actor)).rejects.toThrow("Indica el motivo");
    await setLeadStatus(db, id, "perdido", actor, { lostReason: "No le interesa" });
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c).toMatchObject({ leadStatus: "perdido", lostReason: "No le interesa" });

    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(["whatsapp", "cambio_estado"]));
    expect(acts.filter((a) => a.type === "cambio_estado")).toHaveLength(3); // contactado, pago, perdido
    expect(acts.find((a) => a.type === "whatsapp")).toMatchObject({ direction: "saliente", actorLabel: "prueba", summary: "Primer mensaje" });
  });

  it("respondió, dueño, prioridad y siguiente paso quedan en el contacto y en el timeline", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const { upsertContact } = await import("./contacts");
    const { assignOwner, markReplied, setNextAction, setPriority } = await import("./leads");
    const t = Date.now();
    const { id } = await upsertContact(db, { name: "Lead Dos", email: `lead2${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    const [someone] = await db.select({ id: users.id, name: users.name }).from(users).limit(1);

    await markReplied(db, id, actor, "Dijo que sí le interesa");
    await assignOwner(db, [id], someone.id, actor);
    await setPriority(db, [id], 1, actor);
    await setNextAction(db, id, { text: "Proponer demo", on: "2026-11-12" }, actor);

    const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c).toMatchObject({ leadStatus: "respondio", ownerId: someone.id, priority: 1, nextAction: "Proponer demo", nextActionOn: "2026-11-12" });
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.find((a) => a.direction === "entrante")?.summary).toBe("Dijo que sí le interesa");
    expect(acts.some((a) => a.type === "sistema" && a.summary.includes(someone.name))).toBe(true);
  });

  it("demo agendada avanza al lead y cancelar no lo retrocede", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { applyWebhookDemo } = await import("./demos");
    const { advanceLead } = await import("./leads");
    const t = Date.now();
    const email = `demo${t}@example.com`;
    await applyWebhookDemo(db, { externalId: `x${t}`, fullName: "Demo Lead", email, scheduledAt: new Date(Date.now() + 86400000), source: "test" });
    let [c] = await db.select().from(contacts).where(eq(contacts.email, email));
    expect(c.leadStatus).toBe("demo_agendada");
    await advanceLead(db, c.id, "en_trial", actor);
    await applyWebhookDemo(db, { externalId: `x${t}`, fullName: "Demo Lead", email, source: "test", status: "cancelled" });
    [c] = await db.select().from(contacts).where(eq(contacts.email, email));
    expect(c.leadStatus).toBe("en_trial");
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, c.id));
    expect(acts.filter((a) => a.type === "demo").map((a) => a.summary)).toEqual([expect.stringContaining("Demo agendada"), "Canceló la demo"]);
  });

  it("el sync de usuarios sube a en_trial y pago sin importar mayúsculas y nunca baja", async () => {
    const { db } = await import("@/db");
    const { appUsers, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { syncLeadStatusFromAppUsers } = await import("./leads");
    const t = Date.now();
    const email = `app${t}@example.com`;
    const { id } = await upsertContact(db, { name: "App Lead", email, source: "manual", tags: ["lead"], leadStatus: "contactado" });
    await db.insert(appUsers).values({ uid: `u${t}`, email: ` ${email.toUpperCase()} `, plan: "pro", status: "trialing", syncedAt: new Date() });
    // La base local puede tener otros leads que también avanzan: se afirma sobre este contacto y cotas mínimas.
    const status = async () => (await db.select({ s: contacts.leadStatus }).from(contacts).where(eq(contacts.id, id)))[0].s;
    expect((await syncLeadStatusFromAppUsers(db)).trial).toBeGreaterThanOrEqual(1);
    expect(await status()).toBe("en_trial");
    await db.update(appUsers).set({ status: "active", mrrCents: 69900, currency: "mxn" }).where(eq(appUsers.uid, `u${t}`));
    expect((await syncLeadStatusFromAppUsers(db)).paid).toBeGreaterThanOrEqual(1);
    expect(await status()).toBe("pago");
    await db.update(appUsers).set({ status: "trialing", mrrCents: null }).where(eq(appUsers.uid, `u${t}`));
    expect(await syncLeadStatusFromAppUsers(db)).toEqual({ trial: 0, paid: 0 }); // ya nadie avanza; nunca se baja
    expect(await status()).toBe("pago");
  });

  it("la baja de correo marca perdido:baja salvo a quien ya está en trial o pagando", async () => {
    const { db } = await import("@/db");
    const { contacts } = await import("@/db/schema");
    const { optOut, upsertContact } = await import("./contacts");
    const t = Date.now();
    const a = await upsertContact(db, { name: "Baja A", email: `bajaa${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "contactado" });
    const b = await upsertContact(db, { name: "Baja B", email: `bajab${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "pago" });
    await optOut(db, a.id);
    await optOut(db, b.id);
    const [ca] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    const [cb] = await db.select().from(contacts).where(eq(contacts.id, b.id));
    expect(ca).toMatchObject({ leadStatus: "perdido", lostReason: "baja" });
    expect(cb.leadStatus).toBe("pago");
  });
});
