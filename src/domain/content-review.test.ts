import { describe, expect, it } from "vitest";
import { contentChanged, summarizeReviews } from "./content-review";

const chris = { reviewerId: "c", reviewerRoles: ["ceo" as const] };
const rafa = { reviewerId: "r", reviewerRoles: ["clinical_director" as const] };
const euri = { reviewerId: "e", reviewerRoles: ["sales" as const] };

describe("summarizeReviews: basta el director clínico o, si no puede, el CEO", () => {
  it("sin revisiones falta el director clínico", () => {
    const s = summarizeReviews([]);
    expect(s.missingRoles).toEqual(["clinical_director"]);
    expect(s.complete).toBe(false);
  });

  it("con la aprobación del director clínico está completa", () => {
    const s = summarizeReviews([{ ...rafa, decision: "approved" }]);
    expect(s).toMatchObject({ complete: true, missingRoles: [], approvedRoles: ["clinical_director"] });
  });

  it("si el director clínico no puede, basta el CEO", () => {
    expect(summarizeReviews([{ ...chris, decision: "approved" }]).complete).toBe(true);
  });

  it("los dos pueden aprobar (la segunda es opcional)", () => {
    const s = summarizeReviews([{ ...chris, decision: "approved" }, { ...rafa, decision: "approved" }]);
    expect(s.approvedRoles).toEqual(["clinical_director", "ceo"]);
    expect(s.complete).toBe(true);
  });

  it("ventas ya no cuenta como revisor", () => {
    expect(summarizeReviews([{ ...euri, decision: "approved" }]).complete).toBe(false);
  });

  it("una petición de cambios bloquea aunque el otro apruebe", () => {
    const s = summarizeReviews([{ ...chris, decision: "approved" }, { ...rafa, decision: "changes_requested" }]);
    expect(s.changesRequested).toBe(true);
    expect(s.complete).toBe(false);
  });

  it("aprobar sin rol revisor no cuenta", () => {
    const s = summarizeReviews([{ reviewerId: "m", reviewerRoles: ["marketing"], decision: "approved" }]);
    expect(s.approvedRoles).toEqual([]);
  });
});

describe("contentChanged", () => {
  const base = { title: "A", copy: "texto", assetUrl: null };
  it("detecta cambios en copy", () => expect(contentChanged(base, { ...base, copy: "otro" })).toBe(true));
  it("null y vacío son iguales", () => expect(contentChanged({ ...base, copy: null }, { ...base, copy: "" })).toBe(false));
});
