import { describe, expect, it } from "vitest";
import { dmFor, dmStep, renderDm } from "./social-dm";

describe("mensajes de DM", () => {
  it("dmStep", () => { expect([0, 1, 2, 3, 9].map(dmStep)).toEqual([1, 2, 3, null, null]); });
  it("renderDm sustituye las cuatro variables, todas las veces", () => {
    expect(renderDm("Hola, {nombre}. Soy {yo}. {red}: {liga} {liga}", { nombre: "Ana", yo: "Ale", liga: "L", red: "Instagram" })).toBe("Hola, Ana. Soy Ale. Instagram: L L");
  });
  it("dmFor elige por tipo y paso; sin aprobar no da texto; al cuarto ya no hay mensaje", () => {
    const msgs = [{ key: "RI1", body: "I1 {nombre} {liga}", status: "aprobado" }, { key: "RI2", body: "I2", status: "borrador" }, { key: "RP1", body: "P1 {red}", status: "aprobado" }];
    expect(dmFor({ name: "Ana", socialLeadType: "influencer", socialPlatform: "tiktok" }, 0, msgs, { yo: "Ale", liga: "L" })).toEqual({ key: "RI1", step: 1, text: "I1 Ana L" });
    expect(dmFor({ name: "Ana", socialLeadType: "influencer", socialPlatform: "tiktok" }, 1, msgs, { yo: "Ale", liga: "L" })).toEqual({ key: "RI2", step: 2, text: null });
    expect(dmFor({ name: "Ana", socialLeadType: "psicologo", socialPlatform: "instagram" }, 0, msgs, { yo: "Ale", liga: "L" })!.text).toBe("P1 Instagram");
    expect(dmFor({ name: "Ana", socialLeadType: "psicologo", socialPlatform: "instagram" }, 3, msgs, { yo: "Ale", liga: "L" })).toBeNull();
  });
});
