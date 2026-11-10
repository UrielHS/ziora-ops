import { describe, expect, it } from "vitest";
import { gtmWeekLabel } from "@/lib/gtm";

describe("gtmWeekLabel (plan de 90 días desde el 9-nov-2026)", () => {
  const at = (d: string) => new Date(`${d}T15:00:00-06:00`);
  it("semana 1 el día que arranca y semana 2 una semana después", () => {
    expect(gtmWeekLabel(at("2026-11-09"))).toBe("Semana 1 de 12 del plan de 90 días");
    expect(gtmWeekLabel(at("2026-11-15"))).toBe("Semana 1 de 12 del plan de 90 días");
    expect(gtmWeekLabel(at("2026-11-16"))).toBe("Semana 2 de 12 del plan de 90 días");
  });
  it("nada antes del arranque ni después de la semana 12", () => {
    expect(gtmWeekLabel(at("2026-11-08"))).toBeNull();
    expect(gtmWeekLabel(at("2027-01-31"))).toBe("Semana 12 de 12 del plan de 90 días");
    expect(gtmWeekLabel(at("2027-02-01"))).toBeNull();
  });
});
