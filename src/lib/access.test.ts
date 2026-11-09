import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./access";

describe("isAllowedEmail: solo entra el equipo de Ziora", () => {
  it("acepta correos @ziora-copilot.com sin importar mayúsculas ni espacios", () => {
    expect(isAllowedEmail("chris@ziora-copilot.com")).toBe(true);
    expect(isAllowedEmail("  Euridice@Ziora-Copilot.com ")).toBe(true);
  });
  it("rechaza otros dominios, parecidos y vacíos", () => {
    expect(isAllowedEmail("alguien@gmail.com")).toBe(false);
    expect(isAllowedEmail("x@ziora-copilot.com.evil.com")).toBe(false);
    expect(isAllowedEmail("x@notziora-copilot.com")).toBe(false);
    expect(isAllowedEmail("ziora-copilot.com")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
  });
});
