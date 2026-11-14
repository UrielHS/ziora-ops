import { describe, expect, it } from "vitest";
import { hrefWith, parseCount, resolveSort, sortRows } from "./sort";

describe("resolveSort", () => {
  const cfg = { keys: ["nombre", "alta"] as const, def: "alta" as const, textKeys: ["nombre"] as const };
  it("usa el default y su sentido; texto asc y fechas desc", () => {
    expect(resolveSort({}, cfg)).toEqual({ key: "alta", dir: "desc" });
    expect(resolveSort({ orden: "nombre" }, cfg)).toEqual({ key: "nombre", dir: "asc" });
    expect(resolveSort({ orden: "nombre", dir: "desc" }, cfg)).toEqual({ key: "nombre", dir: "desc" });
  });
  it("ignora columnas y sentidos inválidos", () => {
    expect(resolveSort({ orden: "x; drop", dir: "up" }, cfg)).toEqual({ key: "alta", dir: "desc" });
  });
});

describe("sortRows", () => {
  const rows = [{ n: "Íñigo", v: 2 }, { n: "ana", v: null }, { n: "Beto", v: 10 }, { n: "Ana", v: 2 }];
  it("ordena texto en español sin importar mayúsculas ni acentos, estable", () => {
    expect(sortRows(rows, "asc", (r) => r.n).map((r) => r.n)).toEqual(["ana", "Ana", "Beto", "Íñigo"]);
  });
  it("números en ambos sentidos con los vacíos al final", () => {
    expect(sortRows(rows, "asc", (r) => r.v).map((r) => r.n)).toEqual(["Íñigo", "Ana", "Beto", "ana"]);
    expect(sortRows(rows, "desc", (r) => r.v).map((r) => r.n)).toEqual(["Beto", "Íñigo", "Ana", "ana"]);
  });
  it("fechas", () => {
    const d = [{ d: new Date("2026-01-02") }, { d: new Date("2026-03-01") }];
    expect(sortRows(d, "desc", (r) => r.d)[0]).toBe(d[1]);
  });
});

describe("hrefWith", () => {
  it("combina y quita vacíos", () => {
    expect(hrefWith("/leads", { q: "ana", orden: "nombre" }, { orden: undefined, dir: "asc" })).toBe("/leads?q=ana&dir=asc");
    expect(hrefWith("/leads", {}, {})).toBe("/leads");
  });
});

describe("parseCount", () => {
  it("entiende K, M y separadores", () => {
    expect(parseCount("98.8K")).toBe(98800);
    expect(parseCount("98,8k")).toBe(98800);
    expect(parseCount("1.2M")).toBe(1200000);
    expect(parseCount("5,233")).toBe(5233);
    expect(parseCount("14K")).toBe(14000);
    expect(parseCount("")).toBeNull();
    expect(parseCount("sin dato")).toBeNull();
  });
});
