import { describe, expect, it } from "vitest";
import { isForward, LEAD_ORDER } from "./leads";

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
