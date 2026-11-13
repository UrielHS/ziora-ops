/**
 * Tipo de comprador de un lead (propuesta de captación, nov 2026).
 *
 * Se calcula al vuelo con los datos que ya trae cada ficha: no se guarda en la base,
 * no cambia dueño, etapa, prioridad, segmento ni secuencia. Sirve para ver y filtrar.
 *
 * - institucional:  directores o coordinadores de clínica, consultorio compartido, clínicas, hospitales, universidades.
 * - intencion_alta: atiende 6 o más pacientes por semana, o ya respondió / agendó demo / está en trial / pagó.
 * - volumen:        el resto de los terapeutas, todavía sin señal de interés.
 * - fuera_embudo:   estudiante sin pacientes o no da consulta.
 * - influencer:     lead de redes marcado como influencer (programa de embajadores).
 */

export const BUYER_TYPES = ["institucional", "intencion_alta", "volumen", "fuera_embudo", "influencer"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export const BUYER_TYPE: Record<BuyerType, { label: string; hint: string }> = {
  institucional: { label: "Institucional", hint: "Clínicas, directores, universidades y hospitales" },
  intencion_alta: { label: "Intención alta", hint: "6 o más pacientes por semana, o ya mostró interés" },
  volumen: { label: "Volumen", hint: "Terapeutas sin señal de interés todavía" },
  fuera_embudo: { label: "Fuera del embudo", hint: "Estudiantes sin pacientes o no dan consulta" },
  influencer: { label: "Influencer", hint: "Programa de embajadores" },
};

export type BuyerTypeInput = {
  name?: string | null;
  jobTitle?: string | null;
  patientsPerWeek?: string | null;
  cityName?: string | null;
  notes?: string | null;
  leadStatus?: string | null;
  socialLeadType?: string | null;
  tags?: readonly string[];
};

const INSTITUTIONAL_TAGS = new Set(["clinic", "hospital", "university"]);
const INSTITUTIONAL_TEXT = /director|coordinador|cl[ií]nica o consultorio compartido|universidad|hospital/i;
const PRACTICING_TEXT = /pr[aá]ctica privada|cl[ií]nica o consultorio|pasante|consejer|terapeuta|^psic[oó]log/i;
const STUDENT_TEXT = /estudiante sin pacientes/i;
const NO_PRACTICE_TEXT = /no doy consulta|no doy consulta cl[ií]nica/i;
const ENGAGED_STATUS = new Set(["respondio", "demo_agendada", "en_trial", "pago"]);

/** Número de pacientes por semana a partir del texto de la hoja ("6 a 10", "Más de 20", "0"). Null si no se entiende. */
export function patientsLowerBound(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (/m[aá]s de\s*(\d+)/.test(t)) return Number(t.match(/m[aá]s de\s*(\d+)/)![1]) + 1;
  const n = t.match(/\d+/);
  return n ? Number(n[0]) : null;
}

export function classifyBuyerType(c: BuyerTypeInput): BuyerType {
  if (c.socialLeadType === "influencer") return "influencer";

  const title = c.jobTitle ?? "";
  const tags = c.tags ?? [];
  if (tags.some((t) => INSTITUTIONAL_TAGS.has(t)) || INSTITUTIONAL_TEXT.test(title) || /^director\/a cl[ií]nica$/i.test((c.name ?? "").trim())) {
    return "institucional";
  }

  const freeText = `${c.cityName ?? ""} ${c.notes ?? ""}`;
  const studentOnly = STUDENT_TEXT.test(title) && !PRACTICING_TEXT.test(title.replace(STUDENT_TEXT, ""));
  if (studentOnly || NO_PRACTICE_TEXT.test(freeText)) return "fuera_embudo";

  if (c.leadStatus && ENGAGED_STATUS.has(c.leadStatus)) return "intencion_alta";
  const patients = patientsLowerBound(c.patientsPerWeek);
  if (patients !== null && patients >= 6) return "intencion_alta";

  return "volumen";
}

export function isBuyerType(v: string | undefined): v is BuyerType {
  return !!v && (BUYER_TYPES as readonly string[]).includes(v);
}
