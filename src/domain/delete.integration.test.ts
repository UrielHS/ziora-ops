/**
 * Qué pasa con lo relacionado al borrar (lo que avisa cada botón Eliminar). Corre con RUN_DB_TESTS=1 y DATABASE_URL.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

describe.runIf(enabled)("borrar registros", () => {
  it("pieza: se borran sus revisiones; la sugerencia de origen se queda sin enlace", async () => {
    const { db } = await import("@/db");
    const { contentPieces, contentReviews, contentSuggestions } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const t = Date.now();
    const [u] = await db.insert(users).values({ email: `del${t}@example.com`, name: "Del", role: "operator", active: true }).returning();
    const [p] = await db.insert(contentPieces).values({ title: `Borrar ${t}`, pillar: "memes", channel: "tiktok", channels: ["tiktok"], format: "video" }).returning();
    await db.insert(contentReviews).values({ pieceId: p.id, reviewerId: u.id, decision: "approved" });
    const [s] = await db.insert(contentSuggestions).values({ title: `Sug ${t}`, idea: "Una idea de prueba", pieceId: p.id, status: "accepted" }).returning();

    await db.delete(contentPieces).where(eq(contentPieces.id, p.id));
    expect(await db.select().from(contentReviews).where(eq(contentReviews.pieceId, p.id))).toHaveLength(0);
    const [after] = await db.select().from(contentSuggestions).where(eq(contentSuggestions.id, s.id));
    expect(after.pieceId).toBeNull();
  });

  it("cuenta: se borran sus oportunidades y contratos; los contactos se quedan", async () => {
    const { db } = await import("@/db");
    const { accounts, accountContacts, contacts, contracts, deals } = await import("@/db/schema");
    const t = Date.now();
    const [a] = await db.insert(accounts).values({ name: `Clínica ${t}` }).returning();
    const [c] = await db.insert(contacts).values({ name: "Persona", email: `p${t}@example.com` }).returning();
    await db.insert(accountContacts).values({ accountId: a.id, contactId: c.id });
    const [d] = await db.insert(deals).values({ accountId: a.id, name: `Opp ${t}` }).returning();
    await db.insert(contracts).values({ accountId: a.id, dealId: d.id, title: `Contrato ${t}` });

    await db.delete(accounts).where(eq(accounts.id, a.id));
    expect(await db.select().from(deals).where(eq(deals.accountId, a.id))).toHaveLength(0);
    expect(await db.select().from(contracts).where(eq(contracts.accountId, a.id))).toHaveLength(0);
    expect(await db.select().from(accountContacts).where(eq(accountContacts.accountId, a.id))).toHaveLength(0);
    expect(await db.select().from(contacts).where(eq(contacts.id, c.id))).toHaveLength(1);
  });

  it("sprint: sus tareas regresan al backlog", async () => {
    const { db } = await import("@/db");
    const { sprints, tasks } = await import("@/db/schema");
    const t = Date.now();
    const [s] = await db.insert(sprints).values({ name: `Sprint ${t}`, startsOn: "2026-11-09", endsOn: "2026-11-20" }).returning();
    const [task] = await db.insert(tasks).values({ title: `Tarea ${t}`, sprintId: s.id }).returning();
    await db.delete(sprints).where(eq(sprints.id, s.id));
    const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after.sprintId).toBeNull();
  });
});
