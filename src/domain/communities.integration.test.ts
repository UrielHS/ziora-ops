/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base migrada. */
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CommunityRow } from "./communities";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const actor = { userId: null, label: "prueba" };
const mk = (name: string, url: string): CommunityRow => ({
  name, platform: "facebook", url, country: null, cityRegion: null, topic: null, sizeApprox: null, accessType: null,
  promoPolicy: "desconocido", activity: null, phase: 1, priority: "A", notes: null, sourceUrl: null, kind: "grupo",
});

describe.runIf(enabled)("comunidades: importación, revisión y membresías", () => {
  it("importar dos veces no duplica y todo entra por revisar", async () => {
    const { db } = await import("@/db");
    const { communities } = await import("@/db/schema");
    const { importCommunities } = await import("./communities");
    const t = Date.now();
    const rows = [mk(`Grupo Igual ${t}`, `https://fb.com/${t}/a`), mk(`Grupo Igual ${t}`, `https://fb.com/${t}/b`), mk(`Otro ${t}`, `https://fb.com/${t}/c`)];
    expect(await importCommunities(db, rows, { origin: "tavily_2026_11" })).toEqual({ created: 3, existing: 0 });
    expect(await importCommunities(db, rows, { origin: "tavily_2026_11" })).toEqual({ created: 0, existing: 3 });
    const got = await db.select().from(communities).where(inArray(communities.url, rows.map((r) => r.url)));
    expect(got).toHaveLength(3);
    expect(got.every((c) => c.status === "por_revisar" && c.origin === "tavily_2026_11")).toBe(true);
    const same = got.filter((c) => c.name === `Grupo Igual ${t}`).map((c) => c.slug).sort();
    expect(same[0]).not.toBe(same[1]);
    expect(same.some((s) => s.endsWith("-2"))).toBe(true);
  });

  it("alta manual: recomendada vs manual; liga repetida se rechaza", async () => {
    const { db } = await import("@/db");
    const { communities } = await import("@/db/schema");
    const { createCommunity } = await import("./communities");
    const t = Date.now();
    const a = await createCommunity(db, { name: `Rec ${t}`, platform: "whatsapp", url: `https://wa/${t}/1`, recommendedBy: "Rafa" }, actor);
    const b = await createCommunity(db, { name: `Man ${t}`, platform: "telegram", url: `https://tg/${t}/2` }, actor);
    const [ca] = await db.select().from(communities).where(eq(communities.id, a.id));
    const [cb] = await db.select().from(communities).where(eq(communities.id, b.id));
    expect(ca).toMatchObject({ origin: "recomendada", status: "por_revisar", recommendedBy: "Rafa" });
    expect(cb).toMatchObject({ origin: "manual", status: "por_revisar" });
    await expect(createCommunity(db, { name: "x", platform: "whatsapp", url: `https://wa/${t}/1` }, actor)).rejects.toThrow("ya está");
  });

  it("descartar exige motivo; alianza no vuelve a ser grupo", async () => {
    const { db } = await import("@/db");
    const { communities } = await import("@/db/schema");
    const { createCommunity, reviewCommunity, setPromoPolicy } = await import("./communities");
    const t = Date.now();
    const { id } = await createCommunity(db, { name: `Rev ${t}`, platform: "facebook", url: `https://fb/${t}/r` }, actor);
    await expect(reviewCommunity(db, id, { to: "descartada" } as never, actor)).rejects.toThrow("motivo");
    await reviewCommunity(db, id, { to: "descartada", reason: "inactiva" }, actor);
    let [c] = await db.select().from(communities).where(eq(communities.id, id));
    expect(c).toMatchObject({ status: "descartada", discardReason: "inactiva" });
    await reviewCommunity(db, id, { to: "alianza" }, actor);
    [c] = await db.select().from(communities).where(eq(communities.id, id));
    expect(c).toMatchObject({ kind: "alianza", status: "aprobada", discardReason: null });
    await setPromoPolicy(db, id, "permiso_admin", " solo con permiso ", actor);
    [c] = await db.select().from(communities).where(eq(communities.id, id));
    expect(c).toMatchObject({ promoPolicy: "permiso_admin", rulesText: "solo con permiso" });
  });

  it("membresía única por persona y comunidad; unida fija joinedAt", async () => {
    const { db } = await import("@/db");
    const { communityMemberships } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const { createCommunity, setMembership } = await import("./communities");
    const t = Date.now();
    const { id } = await createCommunity(db, { name: `Mem ${t}`, platform: "facebook", url: `https://fb/${t}/m` }, actor);
    const [u] = await db.insert(users).values({ email: `mem${t}@example.com`, name: "Mem", role: "operator", active: true }).returning({ id: users.id });
    const t1 = new Date("2026-11-10T10:00:00Z"), t2 = new Date("2026-11-11T10:00:00Z");
    await setMembership(db, id, u.id, "solicitud_enviada", t1);
    await setMembership(db, id, u.id, "unida", t2);
    const rows = await db.select().from(communityMemberships).where(eq(communityMemberships.communityId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "unida" });
    expect(rows[0].requestedAt).toEqual(t1);
    expect(rows[0].joinedAt).toEqual(t2);
    await setMembership(db, id, u.id, "salio", new Date("2026-11-12T10:00:00Z"));
    const [after] = await db.select().from(communityMemberships).where(eq(communityMemberships.communityId, id));
    expect(after.leftAt).not.toBeNull();
  });
});
