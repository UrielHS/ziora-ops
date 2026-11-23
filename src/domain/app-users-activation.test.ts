import { describe, expect, it } from "vitest";
import { activation72h, originOf, Snapshot } from "./app-users";

const now = new Date("2026-11-23T18:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);

describe("primera nota en 72 h", () => {
  it("cuenta solo registros de hace 72 h o más y separa los que no tienen fecha", () => {
    const r = activation72h([
      { signedUpAt: h(100), firstNoteAt: h(90), notesTotal: 3 }, // nota a las 10 h: sí
      { signedUpAt: h(200), firstNoteAt: h(50), notesTotal: 1 }, // nota a las 150 h: no
      { signedUpAt: h(200), firstNoteAt: null, notesTotal: 0 }, // nunca: no, pero se sabe
      { signedUpAt: h(200), firstNoteAt: null, notesTotal: 4 }, // tiene notas sin fecha: desconocido
      { signedUpAt: h(10), firstNoteAt: null, notesTotal: 0 }, // aún dentro de la ventana
      { signedUpAt: null, firstNoteAt: null, notesTotal: 0 },
    ], now);
    expect(r).toEqual({ eligible: 4, within: 1, known: 3, waiting: 1 });
  });

  it("acepta firstNoteAt en el snapshot y sigue aceptando snapshots sin él", () => {
    const base = { uid: "u1", email: "a@b.com", plan: "free", status: "free", patientCount: 0 };
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...base, firstNoteAt: "2026-11-20T10:00:00Z" }] }).success).toBe(true);
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...base, firstNoteAt: null }] }).success).toBe(true);
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [base] }).success).toBe(true);
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...base, firstNoteAt: "ayer" }] }).success).toBe(false);
  });
});

describe("origen del registro", () => {
  it("clasifica por utm_medium y ligas de Ops", () => {
    expect(originOf({ attribution: { utm_source: "facebook", utm_medium: "redes" } })).toBe("redes");
    expect(originOf({ attribution: {}, socialLinkId: "x" })).toBe("redes");
    expect(originOf({ attribution: { utm_medium: "comunidad" } })).toBe("comunidad");
    expect(originOf({ attribution: { utm_medium: "vendedor" } })).toBe("vendedor");
    expect(originOf({ attribution: {}, referredByCode: "URIEL-KPE3" })).toBe("vendedor");
    expect(originOf({ attribution: { fbclid: "abc" } })).toBe("anuncios");
    expect(originOf({ attribution: { utm_medium: "email" } })).toBe("otro");
    expect(originOf({ attribution: {} })).toBe("sin_origen");
    expect(originOf({ attribution: null })).toBe("sin_origen");
  });
});
