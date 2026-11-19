import { describe, expect, it } from "vitest";
import { parseLeadSheet } from "./lead-sheet";
import { parseCsv } from "./marketing";

// Encabezados y valores como los exporta el Centro de clientes potenciales de Meta (tabulador, prefijos "p:"/"c:").
const META_TSV = [
  ["id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "form_id", "form_name", "is_organic", "platform",
    "¿cuál_es_tu_puesto?", "¿cuántos_pacientes_atiendes_por_semana?", "¿cómo_documentas_hoy_tus_sesiones?", "¿usas_ia_en_tu_práctica?", "full_name", "email", "phone_number"],
  ["l:111", "2026-11-19T10:00:00-06:00", "ag:1", "video_9x16", "as:2", "35-44", "c:3", "psicologos_nov", "f:4", "Psicólogos nov", "false", "ig",
    "psicólogo/a_en_práctica_privada_independiente", "6_a_10", "word,_docs_o_notas", "sí,_sin_datos_de_pacientes", "Ana Prueba", "ana@example.com", "p:+5215512345678"],
  ["l:112", "2026-11-19T11:00:00-06:00", "ag:1", "imagen_4x5", "as:5", "25-34", "c:3", "psicologos_nov", "f:4", "Psicólogos nov", "false", "fb",
    "estudiante_sin_pacientes", "0", "papel", "no", "Beto Prueba", "", "p:+525598765432"],
].map((r) => r.join("\t")).join("\n");

describe("parseCsv", () => {
  it("detecta el tabulador como separador", () => {
    expect(parseCsv("a\tb\tc\n1\t2\t3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("sigue leyendo coma y punto y coma como antes", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseLeadSheet con el CSV de Meta", () => {
  const { rows, skipped } = parseLeadSheet(META_TSV);

  it("toma nombre, correo y teléfono sin el prefijo p:", () => {
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Ana Prueba", email: "ana@example.com", phone: "+5215512345678" });
    expect(rows[0].phoneE164).toBeTruthy();
    expect(rows[1].email).toBeUndefined();
    expect(rows[1].phoneE164).toBeTruthy();
  });

  it("convierte las respuestas del formulario a texto legible", () => {
    expect(rows[0]).toMatchObject({
      jobTitle: "psicólogo/a en práctica privada independiente",
      patientsPerWeek: "6 a 10",
      documentation: "word, docs o notas",
      aiUsage: "sí, sin datos de pacientes",
    });
  });

  it("guarda los datos de campaña sin prefijos", () => {
    expect(rows[0].meta).toEqual({ createdTime: "2026-11-19T10:00:00-06:00", campaign: "psicologos_nov", adset: "35-44", ad: "video_9x16", form: "Psicólogos nov", platform: "ig" });
  });

  it("una hoja que no es de Meta no lleva datos de campaña", () => {
    const r = parseLeadSheet("Nombre,Email,Rol\nAna,ana@example.com,Psicóloga").rows[0];
    expect(r.meta).toBeUndefined();
    expect(r.jobTitle).toBe("Psicóloga");
  });
});
