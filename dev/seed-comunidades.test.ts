import { describe, expect, it } from "vitest";
import { BASE_MESSAGES, COMMUNITY_CAMPAIGN } from "./seed-comunidades";

describe("semilla de comunidades", () => {
  it("campaña con los valores fijos", () => {
    expect(COMMUNITY_CAMPAIGN).toEqual({ slug: "prueba-1-mes-202611", name: "Prueba de 1 mes · nov 2026", trialDays: 30, paidGoal: 10, seatLimit: 20, active: true });
  });

  it("M0–M6 aprobados, con sus variables y sin frases prohibidas", () => {
    expect(BASE_MESSAGES.map((m) => m.key)).toEqual(["M0", "M1", "M2", "M3", "M4", "M5", "M6"]);
    for (const m of BASE_MESSAGES.filter((m) => m.isPost)) { expect(m.body).toContain("{nombre}"); expect(m.body).toContain("{liga}"); }
    expect(BASE_MESSAGES.find((m) => m.key === "M0")!.isPost).toBe(false);
    expect(BASE_MESSAGES.find((m) => m.key === "M0")!.body).toContain("{admin}");
    expect(BASE_MESSAGES.find((m) => m.key === "M6")!.body).toContain("20");
    expect(BASE_MESSAGES.find((m) => m.key === "M1")!.body.startsWith("Hola, colegas. Soy {nombre}, del equipo de Ziora.")).toBe(true);
    for (const m of BASE_MESSAGES) expect(m.body).not.toMatch(/NOM-004|HIPAA|certificad|100 ?% seguro|avalad/i);
  });
});
