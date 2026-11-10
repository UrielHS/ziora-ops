/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base con ambos schemas (PGlite local, nunca producción). */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

describe.runIf(enabled)("vendedores: esquema (migración 0015)", () => {
  it("la migración 0015 se puede volver a aplicar sin error (idempotente)", async () => {
    const { db } = await import("@/db");
    const statements = readFileSync("drizzle/0015_vendedor.sql", "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(3);
    for (const st of statements) await db.execute(sql.raw(st));
  });

  it("seller_profiles guarda un perfil por usuario y las columnas nuevas existen", async () => {
    const { db } = await import("@/db");
    const { sellerProfiles, contacts, appUsers } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const [u] = await db.select({ id: users.id }).from(users).limit(1);
    await db.delete(sellerProfiles).where(eq(sellerProfiles.userId, u.id));
    await db.insert(sellerProfiles).values({ userId: u.id, referralUrl: "https://ziora-copilot.com/r/PRUEBA-1234" });
    const err = await db.insert(sellerProfiles).values({ userId: u.id }).then(() => null, (e: unknown) => e as Error & { cause?: Error });
    expect(`${err?.cause?.message ?? ""} ${err?.message}`).toMatch(/duplicate key|seller_profiles_pkey/);
    const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, u.id));
    expect(p.referralUrl).toBe("https://ziora-copilot.com/r/PRUEBA-1234");
    expect(p.bookingUrl).toBeNull();
    // columnas aditivas: existen y son null por defecto
    const [c] = await db.select({ e: contacts.emailInvalidAt, p: contacts.phoneInvalidAt }).from(contacts).limit(1);
    expect(c === undefined || (c.e === null || c.e instanceof Date)).toBe(true);
    const cols = await db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'ops' and table_name = 'app_users' and column_name = 'referred_by_code'`);
    expect(cols.length).toBe(1);
    expect(appUsers.referredByCode).toBeDefined();
  });
});

describe.runIf(enabled)("vendedores: perfil", () => {
  it("upsert crea el perfil y luego lo actualiza sin duplicar; vacíos quedan null y el código en mayúsculas", async () => {
    const { db } = await import("@/db");
    const { sellerProfiles } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const { getSellerProfile, upsertSellerProfile } = await import("./sellers");
    const [u] = await db.select({ id: users.id }).from(users).limit(1);
    await db.delete(sellerProfiles).where(eq(sellerProfiles.userId, u.id));
    const a = await upsertSellerProfile(db, u.id, { referralUrl: "https://ziora-copilot.com/r/PRUEBA-1234", discountCode: " euri20 " });
    expect(a).toMatchObject({ userId: u.id, referralUrl: "https://ziora-copilot.com/r/PRUEBA-1234", bookingUrl: null, discountCode: "EURI20" });
    const b = await upsertSellerProfile(db, u.id, { referralUrl: "https://ziora-copilot.com/r/PRUEBA-1234", bookingUrl: "https://calendar.app.google/abc", discountCode: "" });
    expect(b).toMatchObject({ bookingUrl: "https://calendar.app.google/abc", discountCode: null });
    const rows = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, u.id));
    expect(rows).toHaveLength(1);
    expect((await getSellerProfile(db, u.id))?.bookingUrl).toBe("https://calendar.app.google/abc");
  });
});
