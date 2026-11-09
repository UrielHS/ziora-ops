/** Corre con RUN_DB_TESTS=1 y DATABASE_URL (con PGlite: npm run db:local y DB_POOL_MAX=1). */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
// Sin base de datos ni siquiera se ejecuta el bloque (sus imports necesitan DATABASE_URL).
const describeDb = (name: string, fn: () => Promise<void>) =>
  enabled ? describe(name, fn) : describe.skip(name, () => it.skip("necesita RUN_DB_TESTS=1 y DATABASE_URL", () => {}));

describeDb("flujo de contenido", async () => {
  const { db } = await import("@/db");
  const { contentPieces, contentSuggestions, memberRoles, tasks } = await import("@/db/schema");
  const { users } = await import("@/db/shared");
  const c = await import("./content");

  const tag = Date.now();
  type P = { id: string; name: string };
  let ale: P, chris: P, rafa: P, euri: P;
  const mk = async (name: string, role: "marketing" | "ceo" | "clinical_director" | "sales") => {
    const [u] = await db.insert(users).values({ email: `${name}.${tag}@example.com`, name, role: "operator", active: true }).returning();
    await db.insert(memberRoles).values({ userId: u.id, role });
    return { id: u.id, name };
  };
  const base = {
    title: `Pieza ${tag}`, pillar: "ia_psicoterapia" as const, channels: ["instagram" as const], format: "carrusel",
    copy: "Texto original", assetUrl: null, legalChecklistOk: true, sources: [], risk: "low" as const,
  };
  const statusOf = async (id: string) => (await db.select().from(contentPieces).where(eq(contentPieces.id, id)))[0].status;

  beforeAll(async () => {
    ale = await mk("Ale", "marketing");
    chris = await mk("Chris", "ceo");
    rafa = await mk("Rafa", "clinical_director");
    euri = await mk("Euridice", "sales");
  });

  it("no se puede aprobar sin la aprobación del director clínico (o del CEO)", async () => {
    await expect(c.savePiece(db, ale, null, { ...base, status: "approved", ownerId: ale.id })).rejects.toThrow(/Falta la aprobación/);
  });

  it("revisión completa: cambios, corrección y aprobación del director clínico", async () => {
    const { pieceId, sentToReview, notices } = await c.savePiece(db, ale, null, { ...base, status: "legal_review", ownerId: ale.id });
    expect(sentToReview).toBe(true);
    expect(notices[0].to).toEqual(expect.arrayContaining([`Chris.${tag}@example.com`, `Rafa.${tag}@example.com`]));
    expect(notices[0].to).not.toContain(`Euridice.${tag}@example.com`); // ventas ya no revisa

    await expect(c.reviewPiece(db, rafa, { pieceId, decision: "changes_requested" })).rejects.toThrow(/qué hay que cambiar/);
    const r1 = await c.reviewPiece(db, rafa, { pieceId, decision: "changes_requested", comment: "Quitar 'detecta'" });
    expect(r1.status).toBe("draft");
    expect(r1.notices[0].to).toEqual([`Ale.${tag}@example.com`]);

    // Ale corrige el copy: se reinician las revisiones y vuelve a revisión.
    const r2 = await c.savePiece(db, ale, pieceId, { ...base, copy: "Texto corregido", status: "legal_review", ownerId: ale.id });
    expect(r2.resetReviews).toBe(true);
    expect(r2.sentToReview).toBe(true);

    // Ventas ya no puede revisar: su aprobación no mueve la pieza.
    await c.reviewPiece(db, euri, { pieceId, decision: "approved" });
    expect(await statusOf(pieceId)).toBe("legal_review");
    const last = await c.reviewPiece(db, rafa, { pieceId, decision: "approved" });
    expect(last.status).toBe("approved");
    expect(await statusOf(pieceId)).toBe("approved");

    // Programarla ya no requiere nada más.
    await c.savePiece(db, ale, pieceId, { ...base, copy: "Texto corregido", status: "scheduled", ownerId: ale.id });
    expect(await statusOf(pieceId)).toBe("scheduled");

    // Cambiar el copy de una pieza programada reinicia las aprobaciones: sigue programada, pero otra vez "Sin revisar".
    const changed = await c.savePiece(db, ale, pieceId, { ...base, copy: "Otro texto", status: "scheduled", ownerId: ale.id });
    expect(changed).toMatchObject({ status: "scheduled", resetReviews: true, sentToReview: true, scheduledUnreviewed: true });
    // Y aprobarla con el contenido nuevo sin revisión no se puede.
    await expect(c.savePiece(db, ale, pieceId, { ...base, copy: "Otro texto", status: "approved", ownerId: ale.id })).rejects.toThrow(/Falta la aprobación/);
  });

  it("programar sin revisión: se ve como Sin revisar, avisa a revisores y se puede revisar ya programada", async () => {
    const tiktokFb = ["tiktok", "instagram", "facebook"] as ("tiktok" | "instagram" | "facebook")[];
    const r = await c.savePiece(db, ale, null, { ...base, title: `Programada ${tag}`, channels: tiktokFb, status: "scheduled", publishOn: "2026-11-20", legalChecklistOk: false, ownerId: ale.id });
    expect(r).toMatchObject({ status: "scheduled", sentToReview: true, scheduledUnreviewed: true });
    expect(r.notices[0].lines.join(" ")).toMatch(/programada para el 2026-11-20/);
    const [row] = await db.select().from(contentPieces).where(eq(contentPieces.id, r.pieceId));
    expect(row.channels).toEqual(["tiktok", "instagram", "facebook"]);
    expect(row.channel).toBe("tiktok");
    expect(row.reviewRequestedAt).not.toBeNull();

    // Guardar otra vez sin cambiar el contenido no vuelve a avisar.
    const again = await c.savePiece(db, ale, r.pieceId, { ...base, title: `Programada ${tag}`, channels: tiktokFb, status: "scheduled", publishOn: "2026-11-21", legalChecklistOk: false, ownerId: ale.id });
    expect(again.sentToReview).toBe(false);

    // Cambios pedidos: sigue programada.
    const ch = await c.reviewPiece(db, rafa, { pieceId: r.pieceId, decision: "changes_requested", comment: "Falta la fuente" });
    expect(ch.status).toBe("scheduled");
    expect(await statusOf(r.pieceId)).toBe("scheduled");

    // Rafa (quien pidió los cambios) aprueba: queda programada y revisada.
    const last = await c.reviewPiece(db, rafa, { pieceId: r.pieceId, decision: "approved" });
    expect(last.message).toMatch(/programada ya está aprobada/);
    expect(await statusOf(r.pieceId)).toBe("scheduled");
  });

  it("si el director clínico no puede, la aprobación del CEO basta para aprobar", async () => {
    const { pieceId } = await c.savePiece(db, ale, null, { ...base, title: `Solo CEO ${tag}`, status: "legal_review", ownerId: ale.id });
    const r = await c.reviewPiece(db, chris, { pieceId, decision: "approved" });
    expect(r.status).toBe("approved");
  });

  it("Enviar a revisión desde un borrador la pasa a En revisión", async () => {
    const r = await c.savePiece(db, ale, null, { ...base, title: `Borrador ${tag}`, status: "draft", ownerId: ale.id }, { requestReview: true });
    expect(r).toMatchObject({ status: "legal_review", sentToReview: true });
    expect(await statusOf(r.pieceId)).toBe("legal_review");
  });

  it("una pieza necesita al menos un canal", async () => {
    await expect(c.savePiece(db, ale, null, { ...base, title: `Sin canal ${tag}`, channels: [], status: "idea", ownerId: ale.id })).rejects.toThrow(/al menos un canal/);
  });

  it("revisar una pieza que no está en revisión falla", async () => {
    const { pieceId } = await c.savePiece(db, ale, null, { ...base, title: `Idea ${tag}`, status: "idea", ownerId: ale.id });
    await expect(c.reviewPiece(db, chris, { pieceId, decision: "approved" })).rejects.toThrow(/no está en revisión/);
  });

  it("sugerencia aceptada crea pieza y tarea; no se decide dos veces", async () => {
    const id = await c.createSuggestion(db, rafa, { title: `Sugerencia ${tag}`, idea: "Explicar qué es una nota SOAP en 5 láminas", why: "Lo preguntan en demos" });
    const r = await c.decideSuggestion(db, ale, { id, decision: "accepted", pillar: "estudios", channel: "instagram", format: "carrusel", publishOn: "2026-11-20" });
    const [piece] = await db.select().from(contentPieces).where(eq(contentPieces.id, r.pieceId!));
    expect(piece.status).toBe("idea");
    expect(piece.channels).toEqual(["instagram"]);
    expect(piece.copy).toContain("Por qué: Lo preguntan en demos");
    const [task] = await db.select().from(tasks).where(eq(tasks.id, r.taskId!));
    expect(task.title).toBe(`Publicar: Sugerencia ${tag}`);
    expect(task.assigneeId).toBe(ale.id);
    expect(task.reporterId).toBe(rafa.id);
    expect(r.notices[0].to).toEqual([`Rafa.${tag}@example.com`]);
    await expect(c.decideSuggestion(db, ale, { id, decision: "rejected", note: "x" })).rejects.toThrow(/ya se decidió/);
  });

  it("descartar exige motivo", async () => {
    const id = await c.createSuggestion(db, euri, { title: `Otra ${tag}`, idea: "Meme sobre notas a medianoche" });
    await expect(c.decideSuggestion(db, ale, { id, decision: "rejected" })).rejects.toThrow(/por qué/);
    await c.decideSuggestion(db, ale, { id, decision: "rejected", note: "Ya hay uno igual esta semana" });
    const [s] = await db.select().from(contentSuggestions).where(eq(contentSuggestions.id, id));
    expect(s.status).toBe("rejected");
  });
});
