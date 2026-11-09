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
});
