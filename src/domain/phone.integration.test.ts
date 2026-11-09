/** Corre con RUN_DB_TESTS=1: la función SQL ops.normalize_phone_e164 (migración 0012) debe decir lo mismo que la TS. */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "./phone";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

const CASES = ["+52 55 1234 5678", "5512345678", "(55) 1234-5678", "52 1 55 1234 5678", "+1 332 600 3103", "525512345678", "123", "", "+52 55 1234", "5255123456789999"];

describe.runIf(enabled)("paridad SQL ↔ TS del teléfono E.164", () => {
  it.each(CASES)("%s", async (raw) => {
    const { db } = await import("@/db");
    const [row] = await db.execute<{ e164: string | null }>(sql`select ops.normalize_phone_e164(${raw}) as e164`);
    expect(row.e164).toBe(normalizePhoneE164(raw));
  });
  it("null en SQL también es null", async () => {
    const { db } = await import("@/db");
    const [row] = await db.execute<{ e164: string | null }>(sql`select ops.normalize_phone_e164(null) as e164`);
    expect(row.e164).toBeNull();
  });
});
