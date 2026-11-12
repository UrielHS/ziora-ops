import { describe, expect, it } from "vitest";
import { CODE_RE, newPostCode, postEligibility, postUtm, renderMessage, shortLink } from "./community-posts";

const now = new Date("2026-11-20T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("community-posts", () => {
  it("código de 6 caracteres sin ambiguos", () => {
    for (let i = 0; i < 500; i++) expect(newPostCode()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
    expect(CODE_RE.test("k7m2qx")).toBe(true);
    expect(CODE_RE.test("K7M2QX")).toBe(false);
    expect(CODE_RE.test("k7m2q")).toBe(false);
    expect(CODE_RE.test("k7m2q0")).toBe(false);
  });

  it("liga corta con el dominio de la landing", () => {
    delete process.env.LANDING_URL;
    expect(shortLink("k7m2qx")).toBe("https://ziora-copilot.com/c/k7m2qx");
  });

  it("UTM según la convención del spec §8", () => {
    expect(postUtm("k7m2qx", { platform: "facebook", slug: "fb-psicologos-de-mexico" }, "prueba-1-mes-202611")).toEqual({
      utm_source: "facebook", utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611", utm_content: "fb-psicologos-de-mexico", utm_term: "k7m2qx",
    });
    expect(postUtm("k7m2qx", { platform: "asociacion", slug: "as-x" }, "c").utm_source).toBe("otro");
  });

  it("renderMessage sustituye variables y deja las ausentes sin tocar", () => {
    expect(renderMessage("Soy {nombre}: {liga}", { nombre: "Paulina", liga: "https://x/c/a" })).toBe("Soy Paulina: https://x/c/a");
    expect(renderMessage("Hola, {admin}. {nombre}", { nombre: "Ale", admin: "Sam" })).toBe("Hola, Sam. Ale");
  });

  it("elegibilidad: cada regla bloquea con su motivo", () => {
    const ok = { kind: "grupo", status: "aprobada", promoPolicy: "si" } as const;
    expect(postEligibility(ok, "unida", null, now)).toEqual({ ok: true });
    expect(postEligibility({ ...ok, status: "activa" }, "unida", null, now)).toEqual({ ok: true });
    expect(postEligibility({ ...ok, promoPolicy: "desconocido" }, "unida", null, now)).toMatchObject({ ok: false });
    expect(postEligibility({ ...ok, promoPolicy: "permiso_admin" }, "unida", null, now).ok).toBe(false);
    expect(postEligibility({ ...ok, promoPolicy: "no" }, "unida", null, now).ok).toBe(false);
    expect(postEligibility({ ...ok, kind: "alianza" }, "unida", null, now).ok).toBe(false);
    expect(postEligibility({ ...ok, status: "por_revisar" }, "unida", null, now).ok).toBe(false);
    expect(postEligibility({ ...ok, status: "sin_promocion" }, "unida", null, now).ok).toBe(false);
    expect(postEligibility(ok, "solicitud_enviada", null, now).ok).toBe(false);
    expect(postEligibility(ok, null, null, now).ok).toBe(false);
    expect(postEligibility(ok, "unida", daysAgo(20), now).ok).toBe(false);
    expect(postEligibility(ok, "unida", daysAgo(21), now).ok).toBe(true);
  });
});
