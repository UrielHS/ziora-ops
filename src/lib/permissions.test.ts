import { describe, expect, it } from "vitest";
import { ALL_ROLES, PERMISSIONS, can } from "./permissions";

describe("can", () => {
  it("el admin de Event Ops puede todo", () => {
    expect(can({ isAdmin: true, roles: [] }, "team.manage")).toBe(true);
  });

  it("sin roles no puede revisar contenido ni gestionar ventas", () => {
    const a = { isAdmin: false, roles: [] };
    expect(can(a, "content.review")).toBe(false);
    expect(can(a, "sales.manage")).toBe(false);
  });

  it("ventas gestiona contratos, pero ya no revisa contenido ni clasifica tickets", () => {
    const a = { isAdmin: false, roles: ["sales" as const] };
    expect(can(a, "content.review")).toBe(false);
    expect(can({ isAdmin: false, roles: ["clinical_director"] }, "content.review")).toBe(true);
    expect(can({ isAdmin: false, roles: ["ceo"] }, "content.review")).toBe(true);
    expect(can(a, "sales.manage")).toBe(true);
    expect(can(a, "tickets.triage")).toBe(false);
  });

  it("varios roles suman permisos", () => {
    const a = { isAdmin: false, roles: ["dev_qa" as const, "operations" as const] };
    expect(can(a, "tickets.triage")).toBe(true);
    expect(can(a, "team.manage")).toBe(true);
    expect(can(a, "content.review")).toBe(false);
  });

  it("todos pueden sugerir contenido y levantar tickets", () => {
    const a = { isAdmin: false, roles: ["marketing" as const] };
    expect(can(a, "content.suggest")).toBe(true);
    expect(can(a, "tickets.create")).toBe(true);
  });

  it("leads: todos ven; gestionan ventas, ceo, operaciones, director clínico y marketing", () => {
    for (const r of ALL_ROLES) expect(can({ isAdmin: false, roles: [r] }, "leads.view")).toBe(true);
    expect(can({ isAdmin: false, roles: ["marketing"] }, "leads.manage")).toBe(true);
    expect(can({ isAdmin: false, roles: ["dev_qa"] }, "leads.manage")).toBe(false);
    expect(can({ isAdmin: false, roles: ["dev_qa"] }, "contacts.import")).toBe(false);
    expect(can({ isAdmin: false, roles: ["sales"] }, "campaigns.send")).toBe(false);
    expect(can({ isAdmin: false, roles: ["marketing"] }, "campaigns.send")).toBe(true);
    expect(can({ isAdmin: true, roles: [] }, "leads.manage")).toBe(true);
  });

  it("comunidades: operan operaciones, marketing y dirección; solo dirección aprueba mensajes", () => {
    expect(PERMISSIONS["communities.operate"]).toEqual(["operations", "marketing", "ceo"]);
    expect(PERMISSIONS["communities.approve_messages"]).toEqual(["ceo"]);
    expect(can({ isAdmin: false, roles: ["sales"] }, "communities.operate")).toBe(false);
    expect(can({ isAdmin: false, roles: ["marketing"] }, "leads.manage")).toBe(true); // Pau y Ale crean el lead
  });
});
