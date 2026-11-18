/** RUN_DB_TESTS=1 con DATABASE_URL de una base aparte (escribe datos). */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

describe.runIf(enabled)("startLead", () => {
  it("convierte un contacto en lead nuevo con dueño, y no toca a uno que ya era lead", async () => {
    const { db } = await import("@/db");
    const { contacts } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const { upsertContact } = await import("./contacts");
    const { startLead, setLeadStatus } = await import("./leads");
    const [u] = await db.select().from(users).limit(1);
    const actor = { userId: u.id, label: u.name };

    const { id } = await upsertContact(db, { name: "Psic. Solo Contacto", email: `solo${Date.now()}@example.com`, source: "manual", tags: ["psychologist"] });
    let [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBeNull();

    expect((await startLead(db, id, u.id, actor)).added).toBe(true);
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("nuevo");
    expect(c.ownerId).toBe(u.id);
    expect(c.registeredById).toBe(u.id);

    await setLeadStatus(db, id, "contactado", actor);
    expect((await startLead(db, id, null, actor)).added).toBe(false);
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("contactado");
  });
});
