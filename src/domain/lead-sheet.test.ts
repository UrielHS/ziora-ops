import { describe, expect, it } from "vitest";
import { leadTags, parseLeadSheet } from "./lead-sheet";

// Mismo formato que la hoja "Leads Ziora MTW" (datos ficticios).
const CSV = `Prioridad,Segmento,Flag B2B,Nombre,Email,Teléfono,Rol,Pacientes/sem,Enfoque,Documentación,Usa IA,Ciudad,Registrado Panel,Asistió Panel,Registrado Taller,Asistió Taller,Ticket Panel
1,🔥 HOT,,Ana Prueba,Ana.Prueba@Example.com,525500000001,Psicólogo/a en práctica privada independiente,1 a 5,TCC o terapias de tercera generación,"Word, Docs o Notas","No, pero quiero",Ciudad de México,Sí,Sí,Sí,Sí,Presencial
2,❄️ COLD,⭐ Director,Beto Prueba,beto@example.com,525500000002,Director/a o coordinador/a de clínica,0,Sistémico,En papel o libreta,"No, pero quiero",Guadalajara,Sí,,,,Virtual
4,❄️ COLD,,Caro Estudiante,caro@example.com,525500000003,Estudiante sin pacientes,0,Otro,,,cdmx,Sí,,,,
5,💻 COLD-Virtual,,Sin Correo,,525500000004,,,,,,,,,,,
5,💻 COLD-Virtual,,Ana Repetida,ana.prueba@example.com,525500000005,,,,,,,,,,,
`;

describe("hoja de leads", () => {
  const r = parseLeadSheet(CSV);

  it("lee el formato tal cual y normaliza el correo", () => {
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({
      line: 2, email: "ana.prueba@example.com", name: "Ana Prueba", phone: "525500000001", approach: "TCC o terapias de tercera generación",
      jobTitle: "Psicólogo/a en práctica privada independiente", patientsPerWeek: "1 a 5",
      documentation: "Word, Docs o Notas", aiUsage: "No, pero quiero", cityName: "Ciudad de México",
    });
  });

  it("lee prioridad, segmento, flag B2B y asistencia; solo ignora las columnas de registro", () => {
    expect(r.rows[0]).toMatchObject({ priority: 1, segment: "HOT", phoneE164: "525500000001", eventos: { panel: true, taller: true, ticketPanel: "Presencial" } });
    expect(r.rows[1]).toMatchObject({ priority: 2, segment: "COLD", b2bFlag: "Director", eventos: { panel: false, taller: false, ticketPanel: "Virtual" } });
    expect(r.ignoredColumns).toEqual(["Registrado Panel", "Registrado Taller"]);
  });

  it("acepta filas solo con teléfono y salta correos repetidos", () => {
    const sinCorreo = r.rows.find((x) => x.name === "Sin Correo");
    expect(sinCorreo).toMatchObject({ email: undefined, phoneE164: "525500000004" });
    expect(r.skipped).toEqual([{ line: 6, reason: "correo repetido en la hoja (ana.prueba@example.com)" }]);
  });

  it("deduplica por teléfono y salta filas sin correo ni teléfono válido", () => {
    const x = parseLeadSheet("Nombre,Email,Teléfono\nUno,,5512345678\nDos,,+52 55 1234 5678\nNadie,,12\n");
    expect(x.rows).toHaveLength(1);
    expect(x.skipped).toEqual([
      { line: 3, reason: "teléfono repetido en la hoja (525512345678)" },
      { line: 4, reason: "sin correo ni teléfono válido" },
    ]);
  });

  it("deduce etiquetas: lead siempre; psicólogo y clínica según el Rol", () => {
    expect(leadTags(r.rows[0]).sort()).toEqual(["lead", "psychologist"]);
    expect(leadTags(r.rows[1]).sort()).toEqual(["clinic", "lead", "psychologist"]);
    expect(leadTags(r.rows[2])).toEqual(["lead"]); // estudiante: no es psicólogo todavía
    expect(leadTags({ b2bFlag: "Director" })).toEqual(["lead", "clinic"]); // el flag B2B de la hoja también marca clínica
  });

  it("exige Nombre y al menos una columna de Email o Teléfono", () => {
    expect(() => parseLeadSheet("Nombre,Rol\nAna,Psicóloga")).toThrow("Email ni Teléfono");
    expect(() => parseLeadSheet("Email\nana@example.com")).toThrow("Nombre");
    expect(parseLeadSheet("Nombre,Teléfono\nAna,5512345678").rows[0]).toMatchObject({ name: "Ana", phoneE164: "525512345678" });
  });
});
