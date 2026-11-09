import { describe, expect, it } from "vitest";
import { defaultMessage, isForward, LEAD_ORDER } from "./leads";

describe("isForward", () => {
  it("avanza solo hacia adelante en el embudo", () => {
    expect(LEAD_ORDER).toEqual(["nuevo", "contactado", "respondio", "demo_agendada", "en_trial", "pago"]);
    expect(isForward(null, "nuevo")).toBe(true);
    expect(isForward("nuevo", "contactado")).toBe(true);
    expect(isForward("contactado", "pago")).toBe(true);
    expect(isForward("pago", "en_trial")).toBe(false);
    expect(isForward("respondio", "respondio")).toBe(false);
  });

  it("perdido nunca es un avance, ni hacia él ni desde él", () => {
    expect(isForward("nuevo", "perdido")).toBe(false);
    expect(isForward("perdido", "contactado")).toBe(false);
  });
});

describe("defaultMessage", () => {
  it("al lead nuevo le habla por su nombre, se presenta y recuerda Mexico Tech Week", () => {
    const m = defaultMessage({ name: "Ana López", leadStatus: "nuevo" }, "Uriel");
    expect(m).toContain("Ana");
    expect(m).not.toContain("López");
    expect(m).toContain("Uriel");
    expect(m).toContain("Mexico Tech Week");
  });

  it("con demo agendada confirma la demo y ya no menciona el evento", () => {
    const m = defaultMessage({ name: "Ana López", leadStatus: "demo_agendada" }, "Uriel");
    expect(m.toLowerCase()).toContain("demo");
    expect(m).not.toContain("Mexico Tech Week");
  });

  it("nunca incluye precios ni datos clínicos", () => {
    for (const s of ["nuevo", "contactado", "respondio", "demo_agendada", "en_trial", "pago", "perdido", null] as const) {
      expect(defaultMessage({ name: "Ana", leadStatus: s }, "Uriel")).not.toMatch(/\$|MXN|paciente/i);
    }
  });
});
