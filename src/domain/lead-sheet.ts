/**
 * Importación de la hoja de leads ("Leads Ziora MTW"). Se toman Prioridad, Segmento, Flag B2B, Nombre, Email, Teléfono,
 * Rol, Pacientes/sem, Enfoque, Documentación, Usa IA, Ciudad, Asistió Panel, Asistió Taller y Ticket Panel.
 * Los encabezados se reconocen sin importar mayúsculas, acentos o espacios; cualquier otra columna se ignora.
 * Una fila entra con correo o con teléfono válido (los dos son opcionales, pero hace falta uno).
 */
import type { Db } from "@/db";
import type { ContactTag } from "@/db/schema";
import { normalizeEmail, toCity, upsertContact } from "./contacts";
import { parseCsv, slug } from "./marketing";
import { normalizePhoneE164 } from "./phone";

type Field =
  | "name" | "email" | "phone" | "jobTitle" | "patientsPerWeek" | "approach" | "documentation" | "aiUsage" | "cityName"
  | "priority" | "segment" | "b2bFlag" | "attendedPanel" | "attendedWorkshop" | "ticketPanel";

const ALIASES: Record<Field, string[]> = {
  name: ["nombre", "name", "nombre-completo"],
  email: ["email", "correo", "correo-electronico", "e-mail"],
  phone: ["telefono", "phone", "whatsapp", "celular"],
  jobTitle: ["rol", "role", "puesto"],
  patientsPerWeek: ["pacientes-sem", "pacientes-por-semana", "pacientes"],
  approach: ["enfoque"],
  documentation: ["documentacion"],
  aiUsage: ["usa-ia", "uso-de-ia"],
  cityName: ["ciudad", "city"],
  priority: ["prioridad", "priority"],
  segment: ["segmento", "segment"],
  b2bFlag: ["flag-b2b", "b2b"],
  attendedPanel: ["asistio-panel"],
  attendedWorkshop: ["asistio-taller"],
  ticketPanel: ["ticket-panel"],
};

/** Columnas que se importan, en el orden de la hoja. */
export const LEAD_COLUMNS = ["Prioridad", "Segmento", "Flag B2B", "Nombre", "Email", "Teléfono", "Rol", "Pacientes/sem", "Enfoque", "Documentación", "Usa IA", "Ciudad", "Asistió Panel", "Asistió Taller", "Ticket Panel"];

export type LeadRow = {
  line: number;
  name: string;
  email?: string;
  phone?: string;
  phoneE164?: string;
  jobTitle?: string;
  patientsPerWeek?: string;
  approach?: string;
  documentation?: string;
  aiUsage?: string;
  cityName?: string;
  priority?: number; // 1 HOT · 2 WARM · 3 COLD
  segment?: string; // "HOT", "WARM-A", "COLD-Virtual"… sin emoji
  b2bFlag?: string; // "Director"… sin emoji
  eventos?: { panel: boolean; taller: boolean; ticketPanel?: string };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Quita emojis y símbolos decorativos de la hoja ("🔥 HOT" → "HOT"). */
const clean = (s?: string) => s?.replace(/[^\p{L}\p{N}\s\-()./]/gu, "").replace(/\s+/g, " ").trim() || undefined;
const yes = (s?: string) => /^(s[ií]|yes|true|1|x)$/i.test((s ?? "").trim());
/** La hoja usa 1..5; aquí se agrupa en HOT (1), WARM (2) y COLD (3 o más). */
const toPriority = (s?: string) => {
  const n = Number.parseInt(s ?? "", 10);
  return Number.isNaN(n) ? undefined : Math.min(Math.max(n, 1), 3);
};

export function parseLeadSheet(text: string) {
  const [header, ...data] = parseCsv(text);
  if (!header) throw new Error("El archivo está vacío.");
  const keys = header.map((h) => slug(h));
  const col = {} as Partial<Record<Field, number>>;
  (Object.keys(ALIASES) as Field[]).forEach((f) => {
    const i = keys.findIndex((k) => ALIASES[f].includes(k));
    if (i >= 0) col[f] = i;
  });
  if (col.name === undefined) throw new Error("La hoja no tiene columna Nombre.");
  if (col.email === undefined && col.phone === undefined) throw new Error("La hoja no tiene columna Email ni Teléfono.");
  const used = new Set(Object.values(col));
  const ignoredColumns = header.map((h) => h.trim()).filter((h, i) => h && !used.has(i));
  const hasEventos = col.attendedPanel !== undefined || col.attendedWorkshop !== undefined || col.ticketPanel !== undefined;

  const rows: LeadRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  data.forEach((r, idx) => {
    const line = idx + 2; // 1 = encabezados
    const get = (f: Field) => (col[f] === undefined ? undefined : r[col[f]!]?.trim() || undefined);
    const rawEmail = get("email");
    const email = rawEmail ? normalizeEmail(rawEmail) : undefined;
    if (email && !EMAIL.test(email)) return skipped.push({ line, reason: `correo inválido (${email})` });
    const phone = get("phone");
    const phoneE164 = normalizePhoneE164(phone) ?? undefined;
    if (!email && !phoneE164) return skipped.push({ line, reason: "sin correo ni teléfono válido" });
    if (email && seenEmail.has(email)) return skipped.push({ line, reason: `correo repetido en la hoja (${email})` });
    if (!email && phoneE164 && seenPhone.has(phoneE164)) return skipped.push({ line, reason: `teléfono repetido en la hoja (${phoneE164})` });
    if (email) seenEmail.add(email);
    if (phoneE164) seenPhone.add(phoneE164);
    rows.push({
      line, email, phone, phoneE164, name: get("name") ?? email ?? phoneE164!, jobTitle: get("jobTitle"),
      patientsPerWeek: get("patientsPerWeek"), approach: get("approach"), documentation: get("documentation"),
      aiUsage: get("aiUsage"), cityName: get("cityName"),
      priority: toPriority(get("priority")), segment: clean(get("segment")), b2bFlag: clean(get("b2bFlag")),
      eventos: hasEventos ? { panel: yes(get("attendedPanel")), taller: yes(get("attendedWorkshop")), ticketPanel: get("ticketPanel") } : undefined,
    });
  });
  return { rows, skipped, ignoredColumns };
}

/** Etiquetas que se deducen de la hoja: todos son lead; psicólogos y directores de clínica según el Rol o el flag B2B. */
export function leadTags(r: Pick<LeadRow, "jobTitle" | "approach" | "b2bFlag">): ContactTag[] {
  const tags: ContactTag[] = ["lead"];
  const role = (r.jobTitle ?? "").toLowerCase();
  if (/psic/.test(role) || (r.approach && !/estudiante/.test(role))) tags.push("psychologist");
  if (/director|coordinador/.test(role) || /director/i.test(r.b2bFlag ?? "")) tags.push("clinic");
  return tags;
}

export type ImportLeadOptions = {
  /** Dueño que se asigna a los leads nuevos (los que ya tenían dueño lo conservan). */
  ownerId?: string | null;
  /** Base legal del contacto. "evento_luma" registra consentimiento de correo y WhatsApp por el registro al evento. */
  consentSource?: "evento_luma" | null;
};

const LUMA_EVIDENCE = "Registro en Luma · Mexico Tech Week 2026 (panel 26-oct / taller 30-oct)";

/** Crea o completa cada lead (por correo o, si no hay, por teléfono). Nunca duplica ni pisa datos que ya existían. */
export async function importLeadSheet(db: Db, rows: LeadRow[], opts: ImportLeadOptions = {}) {
  let created = 0, completed = 0;
  const consents = opts.consentSource === "evento_luma"
    ? (["email", "whatsapp"] as const).map((channel) => ({ channel, source: "evento_luma", evidence: LUMA_EVIDENCE }))
    : [];
  for (const r of rows) {
    const details: Record<string, unknown> = {};
    if (r.eventos) details.eventos = r.eventos;
    if (r.b2bFlag) details.flagB2B = r.b2bFlag;
    const res = await upsertContact(db, {
      name: r.name, email: r.email, phone: r.phone, phoneE164: r.phoneE164, jobTitle: r.jobTitle, city: toCity(r.cityName), cityName: r.cityName,
      patientsPerWeek: r.patientsPerWeek, approach: r.approach, documentation: r.documentation, aiUsage: r.aiUsage,
      source: "sheet_import", tags: leadTags(r), details,
      leadStatus: "nuevo", priority: r.priority, segment: r.segment, ownerId: opts.ownerId, consents,
    });
    if (res.created) created++; else completed++;
  }
  return { created, completed };
}
