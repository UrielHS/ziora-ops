import { describe, expect, it } from "vitest";
import { SOCIAL_MESSAGES } from "./seed-mensajes-redes";

describe("semilla de mensajes de redes", () => {
  it("la semilla trae los seis mensajes, todos con {liga}, ninguno es post, y RI1 menciona la compensación", () => {
    expect(SOCIAL_MESSAGES.map((m) => m.key)).toEqual(["RP1", "RP2", "RP3", "RI1", "RI2", "RI3"]);
    expect(SOCIAL_MESSAGES.every((m) => m.body.includes("{liga}") && m.isPost === false)).toBe(true);
    expect(SOCIAL_MESSAGES.find((m) => m.key === "RI1")!.body).toMatch(/comisión/);
    expect(SOCIAL_MESSAGES.some((m) => /NOM-004|HIPAA|certificad|100 ?% segur|avalad/i.test(m.body))).toBe(false);
  });
});
