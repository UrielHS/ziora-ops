/** Corre con RUN_DB_TESTS=1 y DATABASE_URL (con PGlite: npm run db:local y DB_POOL_MAX=1). */
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
// Sin base de datos ni siquiera se ejecuta el bloque (sus imports necesitan DATABASE_URL).
const describeDb = (name: string, fn: () => Promise<void>) =>
  enabled ? describe(name, fn) : describe.skip(name, () => it.skip("necesita RUN_DB_TESTS=1 y DATABASE_URL", () => {}));

describeDb("usuarios de la app y seguimiento 1:1", async () => {
  const { db } = await import("@/db");
  const { appUserDaily, appUsers, followups, planPrices } = await import("@/db/schema");
  const { applySnapshot } = await import("./app-users");
  const f = await import("./followups");
  const tag = Date.now();
  const now = new Date("2026-11-03T18:00:00Z");
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
  const u = (id: string, extra: Record<string, unknown>) => ({
    uid: `${id}-${tag}`, email: `${id}-${tag}@example.com`, plan: `pro${tag}`, status: "active", patientCount: 5, sessionsLast30d: 10, lastActiveAt: iso(1), ...extra,
  });

  it("aplica el snapshot, marca bajas, guarda la foto diaria y sugiere seguimientos sin duplicar", async () => {
    await db.insert(planPrices).values({ plan: `pro${tag}`, label: "Pro", priceMxn: 590 }).onConflictDoNothing();
    const first = { generatedAt: now.toISOString(), users: [
      u("activo", {}),
      u("dormido", { lastActiveAt: iso(10), patientCount: 30 }),
      u("trial", { status: "trialing", trialEndsAt: new Date(now.getTime() + 2 * 86400000).toISOString() }),
      u("sebaja", {}),
    ] };
    expect((await applySnapshot(db, first, now)).users).toBe(4);
    const second = { ...first, users: first.users.filter((x) => !x.uid.startsWith("sebaja")) };
    const r = await applySnapshot(db, second, now);
    expect(r.removed).toBeGreaterThanOrEqual(1);
    const [gone] = await db.select().from(appUsers).where(eq(appUsers.uid, `sebaja-${tag}`));
    expect(gone.removedAt).not.toBeNull();

    const [daily] = await db.select().from(appUserDaily).where(and(eq(appUserDaily.plan, `pro${tag}`), eq(appUserDaily.day, "2026-11-03")));
    // "dormido" (10 días) sigue activo con la regla de 14 días, pero ya pide seguimiento (regla de 7).
    expect(daily).toMatchObject({ users: 3, active: 3, paying: 2, patients: 40, estimatedMrrMxn: 1180 });

    expect((await f.suggestFollowups(db, now)).created).toBeGreaterThanOrEqual(2);
    await f.suggestFollowups(db, now);
    const mine = await db.select().from(followups).where(inArray(followups.appUserUid, [`dormido-${tag}`, `trial-${tag}`]));
    expect(mine.map((x) => x.reason).sort()).toEqual(["paying_inactive", "trial_ending"]);

    // El usuario dormido vuelve a entrar: su sugerencia se cancela sola.
    await applySnapshot(db, { ...second, users: second.users.map((x) => (x.uid.startsWith("dormido") ? { ...x, lastActiveAt: iso(0) } : x)) }, now);
    expect(await f.closeStaleSuggestions(db, now)).toBeGreaterThanOrEqual(1);
    const [s] = await db.select().from(followups).where(eq(followups.appUserUid, `dormido-${tag}`));
    expect(s.status).toBe("cancelled");

    // Completar uno agenda el siguiente.
    const trial = mine.find((x) => x.reason === "trial_ending")!;
    await expect(f.completeFollowup(db, { id: trial.id, outcome: " ", health: "green" })).rejects.toThrow(/cómo fue/);
    const { nextId } = await f.completeFollowup(db, { id: trial.id, outcome: "Le gustó, pide factura", health: "green", nextDueOn: "2026-11-10", nextAction: "Confirmar pago" });
    const [next] = await db.select().from(followups).where(eq(followups.id, nextId!));
    expect(next).toMatchObject({ status: "pending", title: "Confirmar pago", dueOn: "2026-11-10", reason: "manual" });
    await expect(f.completeFollowup(db, { id: trial.id, outcome: "otra vez", health: "green" })).rejects.toThrow(/ya se cerró/);
  });

  it("guarda el código de referido del snapshot y lo conserva si el snapshot no lo trae", async () => {
    const { db } = await import("@/db");
    const { appUsers } = await import("@/db/schema");
    const { applySnapshot, Snapshot } = await import("./app-users");
    const { eq } = await import("drizzle-orm");
    const now = new Date();
    const uid = `ref-${now.getTime()}`;
    const base = { uid, email: `${uid}@example.com`, plan: "free", status: "free", patientCount: 0, sessionsLast30d: 0 };
    await applySnapshot(db, Snapshot.parse({ generatedAt: now.toISOString(), users: [{ ...base, referredByCode: "CHRIST-ERWK" }] }), now);
    let [u] = await db.select().from(appUsers).where(eq(appUsers.uid, uid));
    expect(u.referredByCode).toBe("CHRIST-ERWK");
    await applySnapshot(db, Snapshot.parse({ generatedAt: now.toISOString(), users: [base] }), now);
    [u] = await db.select().from(appUsers).where(eq(appUsers.uid, uid));
    expect(u.referredByCode).toBe("CHRIST-ERWK");
    await applySnapshot(db, Snapshot.parse({ generatedAt: now.toISOString(), users: [{ ...base, referredByCode: null }] }), now);
    [u] = await db.select().from(appUsers).where(eq(appUsers.uid, uid));
    expect(u.referredByCode).toBe("CHRIST-ERWK"); // la atribución es permanente en la app: null tampoco la borra
    await applySnapshot(db, Snapshot.parse({ generatedAt: now.toISOString(), users: [{ ...base, referredByCode: "OTRO-CODE" }] }), now);
    [u] = await db.select().from(appUsers).where(eq(appUsers.uid, uid));
    expect(u.referredByCode).toBe("OTRO-CODE");
  });

  it("una cuenta de prueba se conserva al sincronizar y no cuenta en el resumen ni en seguimientos", async () => {
    const { setAppUserTest } = await import("./app-users");
    const plan = `pt${tag}`;
    await db.insert(planPrices).values({ plan, label: "Prueba", priceMxn: 590 }).onConflictDoNothing();
    const snap = (extra: Record<string, unknown> = {}) => ({ generatedAt: now.toISOString(), users: [
      { uid: `real-${tag}`, email: `real-${tag}@example.com`, plan, status: "active", patientCount: 4, sessionsLast30d: 3, lastActiveAt: iso(1) },
      { uid: `yo-${tag}`, email: `yo-${tag}@example.com`, plan, status: "active", patientCount: 9, sessionsLast30d: 9, lastActiveAt: iso(9), ...extra },
    ] });
    await applySnapshot(db, snap(), now);
    await setAppUserTest(db, `yo-${tag}`, true);
    await applySnapshot(db, snap({ name: "Cambio de nombre" }), now); // la app la vuelve a mandar

    const [yo] = await db.select().from(appUsers).where(eq(appUsers.uid, `yo-${tag}`));
    expect(yo).toMatchObject({ isTest: true, name: "Cambio de nombre" });
    const [daily] = await db.select().from(appUserDaily).where(eq(appUserDaily.plan, plan));
    expect(daily).toMatchObject({ users: 1, patients: 4, estimatedMrrMxn: 590 });

    await f.suggestFollowups(db, now); // "yo" no entra hace 9 días y paga: sería candidata si no fuera de prueba
    expect(await db.select().from(followups).where(eq(followups.appUserUid, `yo-${tag}`))).toHaveLength(0);
  });
  it("el usuario queda ligado a su comunidad y post por utm_term, y la atribución no se pierde", async () => {
    const { communities, communityPosts } = await import("@/db/schema");
    const t = Date.now().toString(36);
    const [community] = await db.insert(communities).values({ name: `Grupo ${t}`, platform: "facebook", url: `https://fb.com/${t}-a`, slug: `au-grupo-${t}` }).returning();
    const code = ("k" + t).slice(-6).replace(/[^a-hj-km-np-z2-9]/g, "k").padStart(6, "k");
    const [post] = await db.insert(communityPosts).values({ code, communityId: community.id }).returning();
    const uid = `v2-${t}`;
    const base = { uid, email: `${uid}@example.com`, plan: "free", status: "free", patientCount: 0, sessionsLast30d: 0 };
    const attribution = { utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611", utm_term: code, utm_content: community.slug };
    await applySnapshot(db, { generatedAt: now.toISOString(), users: [{ ...base, attribution, trialKind: "community", hasPaidInvoice: false, feedbackCount: 1, sessionsTotal: 3, notesTotal: 2 }] }, now);
    let [row] = await db.select().from(appUsers).where(eq(appUsers.uid, uid));
    expect(row).toMatchObject({ trialKind: "community", communityId: community.id, communityPostId: post.id, hasPaidInvoice: false, feedbackCount: 1, sessionsTotal: 3, notesTotal: 2 });
    expect(row.attribution).toEqual(attribution);
    // segundo snapshot sin atribución ni tipo de prueba (v1) → se conserva todo
    await applySnapshot(db, { generatedAt: now.toISOString(), users: [base] }, now);
    [row] = await db.select().from(appUsers).where(eq(appUsers.uid, uid));
    expect(row).toMatchObject({ trialKind: "community", communityId: community.id, communityPostId: post.id, sessionsTotal: 3, hasPaidInvoice: false });
    expect(row.attribution).toEqual(attribution);
    await applySnapshot(db, { generatedAt: now.toISOString(), users: [{ ...base, attribution: null, trialKind: null, sessionsTotal: 5, notesTotal: 2, feedbackCount: 1 }] }, now);
    [row] = await db.select().from(appUsers).where(eq(appUsers.uid, uid));
    expect(row).toMatchObject({ trialKind: "community", sessionsTotal: 5 });
    expect(row.attribution).toEqual(attribution);
  });

  it("sin post, liga por utm_content; entrada directa queda sin comunidad", async () => {
    const { communities } = await import("@/db/schema");
    const t = Date.now().toString(36);
    const [community] = await db.insert(communities).values({ name: `Grupo ${t}`, platform: "whatsapp", url: `https://wa.me/${t}-b`, slug: `au-slug-${t}` }).returning();
    const a = `slug-${t}`, b = `directo-${t}`;
    const mk = (uid: string, attribution: Record<string, string>) => ({ uid, email: `${uid}@example.com`, plan: "free", status: "free", patientCount: 0, sessionsLast30d: 0, attribution, trialKind: "community" });
    await applySnapshot(db, { generatedAt: now.toISOString(), users: [
      mk(a, { utm_medium: "comunidad", utm_content: community.slug }),
      mk(b, { utm_source: "directo", utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611" }),
    ] }, now);
    const [ra] = await db.select().from(appUsers).where(eq(appUsers.uid, a));
    const [rb] = await db.select().from(appUsers).where(eq(appUsers.uid, b));
    expect(ra).toMatchObject({ communityId: community.id, communityPostId: null });
    expect(rb).toMatchObject({ communityId: null, communityPostId: null, trialKind: "community" });
  });
});
