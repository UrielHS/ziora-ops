import { describe, expect, it } from "vitest";
import { classifyBuyerType, isBuyerType, patientsLowerBound } from "./buyer-type";

describe("patientsLowerBound", () => {
  it("lee los rangos de la hoja", () => {
    expect(patientsLowerBound("0")).toBe(0);
    expect(patientsLowerBound("1 a 5")).toBe(1);
    expect(patientsLowerBound("6 a 10")).toBe(6);
    expect(patientsLowerBound("11 a 20")).toBe(11);
    expect(patientsLowerBound("Más de 20")).toBe(21);
    expect(patientsLowerBound("")).toBeNull();
    expect(patientsLowerBound(null)).toBeNull();
    expect(patientsLowerBound("No sé")).toBeNull();
  });
});

describe("classifyBuyerType", () => {
  it("director o coordinador de clínica es institucional", () => {
    expect(classifyBuyerType({ jobTitle: "Director/a o coordinador/a de clínica", patientsPerWeek: "1 a 5" })).toBe("institucional");
    expect(classifyBuyerType({ jobTitle: "Psicólogo/a en clínica o consultorio compartido" })).toBe("institucional");
    expect(classifyBuyerType({ name: "Director/a clínica", jobTitle: null })).toBe("institucional");
    expect(classifyBuyerType({ jobTitle: null, tags: ["lead", "university"] })).toBe("institucional");
  });

  it("estudiante sin pacientes o quien no da consulta queda fuera del embudo", () => {
    expect(classifyBuyerType({ jobTitle: "Estudiante sin pacientes" })).toBe("fuera_embudo");
    expect(classifyBuyerType({ jobTitle: "Otro", cityName: "Ciudad de México. No doy consulta clínica." })).toBe("fuera_embudo");
  });

  it("estudiante que también tiene práctica privada no queda fuera", () => {
    expect(classifyBuyerType({ jobTitle: "Estudiante sin pacientes, Psicólogo/a en práctica privada independiente", patientsPerWeek: "6 a 10" })).toBe("intencion_alta");
  });

  it("6 o más pacientes por semana es intención alta; menos es volumen", () => {
    expect(classifyBuyerType({ jobTitle: "Psicólogo/a en práctica privada independiente", patientsPerWeek: "6 a 10" })).toBe("intencion_alta");
    expect(classifyBuyerType({ jobTitle: "Psicólogo/a en práctica privada independiente", patientsPerWeek: "1 a 5" })).toBe("volumen");
    expect(classifyBuyerType({ jobTitle: "Psicólogo/a en práctica privada independiente" })).toBe("volumen");
  });

  it("quien ya respondió, agendó demo, está en trial o pagó es intención alta", () => {
    for (const s of ["respondio", "demo_agendada", "en_trial", "pago"]) {
      expect(classifyBuyerType({ jobTitle: "Otro", leadStatus: s })).toBe("intencion_alta");
    }
    expect(classifyBuyerType({ jobTitle: "Otro", leadStatus: "contactado" })).toBe("volumen");
  });

  it("los influencers de redes van aparte, aunque sean psicólogos con pacientes", () => {
    expect(classifyBuyerType({ socialLeadType: "influencer", patientsPerWeek: "Más de 20" })).toBe("influencer");
    expect(classifyBuyerType({ socialLeadType: "psicologo" })).toBe("volumen");
  });
});

describe("isBuyerType", () => {
  it("solo acepta los valores conocidos", () => {
    expect(isBuyerType("institucional")).toBe(true);
    expect(isBuyerType("otro")).toBe(false);
    expect(isBuyerType(undefined)).toBe(false);
  });
});
