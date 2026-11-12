import { describe, expect, it } from "vitest";
import { canMoveStage, promoStats, usesZiora } from "./influencers";

const now = new Date("2026-11-12T12:00:00Z");
const prices = [
  { plan: "free", priceMxn: 0, billingPeriod: "monthly" as const, paying: false },
  { plan: "pro", priceMxn: 699, billingPeriod: "monthly" as const, paying: true },
];

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
  it("promoStats separa registros, en prueba y pagando", () => {
    const u = (o: object) => ({ status: "free", plan: "free", mrrCents: null, currency: null, trialKind: null, trialEndsAt: null, ...o });
    expect(promoStats([
      u({ trialKind: "community", trialEndsAt: new Date(now.getTime() + 86_400_000) }),
      u({ trialKind: "community", trialEndsAt: new Date(now.getTime() - 86_400_000) }),
      u({ status: "active", plan: "pro", mrrCents: 69900, currency: "mxn" }),
      u({ status: "trialing", plan: "pro" }),
    ], prices, now)).toEqual({ signups: 4, inTrial: 2, paying: 1 });
  });
});
