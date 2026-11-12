import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { communitySlug, parseCommunitiesCsv } from "./communities";

describe("communities", () => {
  it("slug con prefijo de plataforma, sin acentos", () => {
    expect(communitySlug("facebook", "Psicólogos de México")).toBe("fb-psicologos-de-mexico");
    expect(communitySlug("whatsapp", "  Red ¡PSI! CDMX  ")).toBe("wa-red-psi-cdmx");
    expect(communitySlug("facebook", "x".repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it.runIf(!!process.env.COMUNIDADES_CSV)("lee el CSV real con BOM: 144 filas, sin descartes", () => {
    const { rows, skipped } = parseCommunitiesCsv(readFileSync(process.env.COMUNIDADES_CSV!, "utf8"));
    expect(rows).toHaveLength(144);
    expect(skipped).toEqual([]);
    expect(rows.filter((r) => r.phase === 1)).toHaveLength(93);
    expect(rows.filter((r) => r.kind === "alianza")).toHaveLength(27);
    expect(rows.filter((r) => r.promoPolicy === "desconocido")).toHaveLength(137);
  });

  it("mapea columnas y descarta filas sin nombre o sin URL", () => {
    const csv = [
      "nombre,plataforma,url,pais,ciudad_region,enfoque_o_tema,tamano_aprox,tipo_acceso,permite_promocion,actividad,fase,prioridad,notas,fuente",
      '"Psicólogos, CDMX",facebook,https://fb.com/a,México,CDMX,clínica,5000,publico,si,alta,1,A,"nota, con coma",https://fb.com/a',
      ",whatsapp,https://wa.me/x,,,,,,,,,,,",
      "Sin url,telegram,,,,,,,,,,,,",
      "Colegio X,asociacion,https://colegio.mx,,,,,,raro,,dos,Z,,",
    ].join("\n");
    const { rows, skipped } = parseCommunitiesCsv(csv);
    expect(skipped).toEqual([{ line: 3, reason: "sin nombre" }, { line: 4, reason: "sin URL" }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Psicólogos, CDMX", platform: "facebook", promoPolicy: "si", phase: 1, priority: "A", notes: "nota, con coma", kind: "grupo" });
    expect(rows[1]).toMatchObject({ platform: "asociacion", kind: "alianza", promoPolicy: "desconocido", phase: null, priority: null });
  });
});
