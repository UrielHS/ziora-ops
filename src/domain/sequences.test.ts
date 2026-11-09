import { describe, expect, it } from "vitest";
import { cadenceVars, computeNextRunAt, inSendingWindow, renderWhatsapp, touchLabel } from "./sequences";

describe("computeNextRunAt", () => {
  const enrolled = new Date("2026-11-09T22:30:00-06:00");
  it("offset 0 corre ya", () => {
    expect(computeNextRunAt(enrolled, 0, enrolled).toISOString()).toBe(enrolled.toISOString());
  });
  it("offset 3 son las 10:00 CDMX tres días después", () => {
    expect(computeNextRunAt(enrolled, 3, enrolled).toISOString()).toBe(new Date("2026-11-12T10:00:00-06:00").toISOString());
  });
  it("si la hora calculada ya pasó, corre ya", () => {
    const now = new Date("2026-11-13T09:00:00-06:00");
    expect(computeNextRunAt(enrolled, 3, now).toISOString()).toBe(now.toISOString());
  });
});

describe("inSendingWindow", () => {
  it("8:00 sí, 19:59 sí, 20:00 no, 7:59 no (CDMX)", () => {
    expect(inSendingWindow(new Date("2026-11-10T08:00:00-06:00"))).toBe(true);
    expect(inSendingWindow(new Date("2026-11-10T19:59:00-06:00"))).toBe(true);
    expect(inSendingWindow(new Date("2026-11-10T20:00:00-06:00"))).toBe(false);
    expect(inSendingWindow(new Date("2026-11-10T07:59:00-06:00"))).toBe(false);
  });
});

describe("variables y WhatsApp", () => {
  it("remitente es el nombre de pila del dueño o el equipo", () => {
    expect(cadenceVars({ name: "Ana López", email: "a@x.mx", cityName: "CDMX" }, "Uriel Hernández")).toMatchObject({ nombre: "Ana", remitente: "Uriel", ciudad: "CDMX" });
    expect(cadenceVars({ name: "Ana", email: null, cityName: null }, null).remitente).toBe("el equipo de Ziora");
  });
  it("renderWhatsapp no deja entidades HTML", () => {
    expect(renderWhatsapp("Hola {{nombre}} & co", { nombre: 'Ana "la" <jefa>' })).toBe('Hola Ana "la" <jefa> & co');
  });
  it("touchLabel", () => {
    expect(touchLabel(2, 4, "whatsapp")).toBe("Toque 2 de 4 · WhatsApp");
  });
});
