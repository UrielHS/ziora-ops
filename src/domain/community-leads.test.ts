import { describe, expect, it } from "vitest";
import { nextOwner } from "./community-leads";

describe("reparto de leads de comunidad", () => {
  it("alterna uno y uno", () => {
    expect(nextOwner(["u", "c"], -1)).toEqual({ ownerId: "u", index: 0 });
    expect(nextOwner(["u", "c"], 0)).toEqual({ ownerId: "c", index: 1 });
    expect(nextOwner(["u", "c"], 1)).toEqual({ ownerId: "u", index: 0 });
    expect(nextOwner([], 0)).toBeNull();
  });
  it("un last fuera de rango o raro no rompe", () => {
    expect(nextOwner(["u", "c"], 7)).toEqual({ ownerId: "u", index: 0 });
    expect(nextOwner(["u", "c"], Number.NaN)).toEqual({ ownerId: "u", index: 0 });
  });
});
