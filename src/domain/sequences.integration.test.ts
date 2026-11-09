/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base con ambos schemas (PGlite local, nunca producción). */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

describe.runIf(enabled)("cadencia: esquema", () => {
  it("un contacto no puede tener dos enrollments activos en la misma secuencia", async () => {
    const { db } = await import("@/db");
    const { sequences, sequenceEnrollments } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const t = Date.now();
    const [seq] = await db.insert(sequences).values({ name: `Prueba ${t}` }).returning();
    const { id } = await upsertContact(db, { name: "Enrolado", email: `enr${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id });
    // drizzle envuelve el error de Postgres ("Failed query…"); el detalle viene en cause.
    const err = await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id }).then(() => null, (e: unknown) => e as Error & { cause?: Error });
    expect(err).not.toBeNull();
    expect(`${err?.cause?.message ?? ""} ${err?.message}`).toMatch(/enrollments_active_unique|duplicate key/);
    await db.update(sequenceEnrollments).set({ status: "terminada" }).where(eq(sequenceEnrollments.contactId, id));
    await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id }); // ya no choca
  });
});
