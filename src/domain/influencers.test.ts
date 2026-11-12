import { describe, expect, it } from "vitest";
import { canMoveStage, usesZiora } from "./influencers";

describe("influencers", () => {
  it("canMoveStage", () => {
    expect(canMoveStage(null, "opinion_recibida")).toBe(true);
    expect(canMoveStage("opinion_recibida", "quiere_promover")).toBe(true);
    expect(canMoveStage("no_promueve", "quiere_promover")).toBe(true);
    expect(canMoveStage(null, "acuerdo_cerrado")).toBe(false);
    expect(canMoveStage("opinion_recibida", "acuerdo_cerrado")).toBe(false);
    expect(canMoveStage("acuerdo_cerrado", "no_promueve")).toBe(false);
    expect(canMoveStage("quiere_promover", "acuerdo_cerrado")).toBe(true);
    expect(canMoveStage("quiere_promover", "no_promueve")).toBe(true);
    expect(canMoveStage("opinion_recibida", "no_promueve")).toBe(true);
    expect(canMoveStage("quiere_promover", "opinion_recibida")).toBe(false);
  });
  it("usesZiora", () => {
    expect(usesZiora({ sessionsTotal: 1, removedAt: null })).toBe(true);
    expect(usesZiora({ sessionsTotal: 0, removedAt: null })).toBe(false);
    expect(usesZiora({ sessionsTotal: 5, removedAt: new Date() })).toBe(false);
    expect(usesZiora(null)).toBe(false);
    expect(usesZiora(undefined)).toBe(false);
  });
});
