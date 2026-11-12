import { describe, expect, it } from "vitest";
import { normalizeHandle, socialProfileUrl } from "./social-leads";

describe("social-leads", () => {
  it("normalizeHandle: todas las formas del mismo usuario dan lo mismo", () => {
    for (const raw of ["@Psic.Ana_01", "psic.ana_01", " PSIC.ANA_01/ ", "https://www.instagram.com/psic.ana_01/",
      "instagram.com/Psic.Ana_01?igsh=abc123", "https://instagram.com/psic.ana_01/reels/", "https://www.tiktok.com/@psic.ana_01?lang=es"]) {
      expect(normalizeHandle(raw)).toBe("psic.ana_01");
    }
  });
  it("normalizeHandle rechaza lo que no es un usuario", () => {
    for (const raw of [null, undefined, "", "   ", "@", "con espacio", "a".repeat(31), "https://www.instagram.com/", "https://facebook.com/alguien", "ñandú"]) {
      expect(normalizeHandle(raw)).toBeNull();
    }
  });
  it("normalizeHandle: usuarios con punto que parecen dominio no se pierden", () => {
    for (const h of ["dra.lopez", "psic.ana", "terapia.mx"]) {
      for (const raw of [h, `@${h}`, `${h}/`, h.toUpperCase(), `https://www.instagram.com/${h}/`, `instagram.com/${h}?igsh=x`, `https://www.tiktok.com/@${h}?lang=es`]) {
        expect(normalizeHandle(raw)).toBe(h);
      }
    }
  });
  it("normalizeHandle: otras redes se rechazan; facebook.com a secas es un usuario sintácticamente válido", () => {
    expect(normalizeHandle("https://facebook.com/alguien")).toBeNull();
    expect(normalizeHandle("facebook.com/alguien")).toBeNull();
    expect(normalizeHandle("https://facebook.com")).toBeNull();
    expect(normalizeHandle("https://www.instagram.com")).toBeNull();
    expect(normalizeHandle("instagram.com")).toBeNull();
    expect(normalizeHandle("facebook.com")).toBe("facebook.com");
  });
  it("socialProfileUrl", () => {
    expect(socialProfileUrl("instagram", "psic.ana_01")).toBe("https://www.instagram.com/psic.ana_01/");
    expect(socialProfileUrl("tiktok", "psic.ana_01")).toBe("https://www.tiktok.com/@psic.ana_01");
  });
});
