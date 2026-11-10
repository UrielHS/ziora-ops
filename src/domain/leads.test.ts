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

describe("todayBuckets (Mi día)", async () => {
  const { todayBuckets } = await import("./leads");
  const mk = (id: string, nextActionOn: string | null, leadStatus = "contactado", priority: number | null = 2) =>
    ({ id, nextActionOn, leadStatus, priority }) as unknown as Parameters<typeof todayBuckets>[0][number];
  const cad = (id: string, pendingText: string | null, status: "activa" | "terminada" = "activa") =>
    [id, { enrollmentId: "e", sequenceName: "MTW", status, touches: 1, total: 4, nextRunAt: new Date("2026-11-13T16:00:00Z"), nextChannel: "email" as const, pendingText, stopReason: null }] as const;

  it("un lead en secuencia activa que espera su siguiente paso no cae en 'Sin siguiente paso'", () => {
    const rows = [mk("a", null), mk("b", null), mk("c", "2026-11-09"), mk("d", null, "nuevo")];
    const cadence = new Map([cad("a", null), cad("c", "Hola")]);
    const b = todayBuckets(rows, cadence, "2026-11-09", "2026-11-16");
    expect(b.due.map((r) => r.id)).toEqual(["c"]);
    expect(b.noPlan.map((r) => r.id)).toEqual(["b", "d"]);
    expect(b.inSequence.map((r) => r.id)).toEqual(["a"]);
  });

  it("una secuencia terminada no retira al lead de 'Sin siguiente paso'", () => {
    const b = todayBuckets([mk("a", null)], new Map([cad("a", null, "terminada")]), "2026-11-09", "2026-11-16");
    expect(b.noPlan.map((r) => r.id)).toEqual(["a"]);
    expect(b.inSequence).toEqual([]);
  });
});

describe("ownerFilter (filtro «Dueño» del kanban)", async () => {
  const { ownerFilter } = await import("./leads");
  it("sin parámetro o con basura no filtra; «ninguno» pide sin dueño; un uuid pide a esa persona", () => {
    expect(ownerFilter(undefined)).toEqual({ kind: "any" });
    expect(ownerFilter("")).toEqual({ kind: "any" });
    expect(ownerFilter("lo que sea")).toEqual({ kind: "any" });
    expect(ownerFilter("ninguno")).toEqual({ kind: "none" });
    expect(ownerFilter("0f738b62-1fe1-436a-8cd7-c01e60bea639")).toEqual({ kind: "user", id: "0f738b62-1fe1-436a-8cd7-c01e60bea639" });
  });
});
