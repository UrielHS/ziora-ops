import { describe, expect, it } from "vitest";
import { actualMix, DEFAULT_MIX, validateMix } from "./content-mix";

describe("mezcla de contenido", () => {
  it("la meta por defecto es 40 / 40 / 20", () => {
    expect(DEFAULT_MIX).toEqual({ education: 40, entertainment: 40, product: 20 });
  });

  it("agrupa los pilares: educación, entretenimiento (memes) y datos del producto (producto y ROI)", () => {
    const pieces = ["estudios", "ia_psicoterapia", "memes", "memes", "producto", "roi", "psicoterapia_moderna", "memes", "estudios", "producto"].map((pillar) => ({ pillar }));
    expect(actualMix(pieces)).toEqual({ education: 40, entertainment: 30, product: 30 });
    expect(actualMix([])).toEqual({ education: 0, entertainment: 0, product: 0 });
  });

  it("la meta editada debe sumar 100 con enteros de 0 a 100", () => {
    expect(() => validateMix({ education: 50, entertainment: 30, product: 20 })).not.toThrow();
    expect(() => validateMix({ education: 50, entertainment: 40, product: 20 })).toThrow(/sumar 100 \(ahora suman 110\)/);
    expect(() => validateMix({ education: 120, entertainment: -10, product: -10 })).toThrow(/0 a 100/);
  });
});
