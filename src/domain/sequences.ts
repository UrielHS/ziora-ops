/**
 * Cadencia de leads (spec §4.4): secuencias de toques por correo y WhatsApp.
 * Funciones puras aquí arriba; enrolar, correr el job y parar más abajo (Task 3).
 */
import { firstName, renderTemplate, type TemplateVars } from "./template";

export const SENDING_TZ = "America/Mexico_City";
const SEND_HOUR = 10; // hora CDMX a la que se programan los pasos con offset > 0
const CDMX_OFFSET = "-06:00"; // CDMX no tiene horario de verano desde 2022

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: SENDING_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: SENDING_TZ, hour: "numeric", hour12: false });

/** Fecha YYYY-MM-DD en CDMX. */
export function cdmxDay(d: Date): string {
  return dayFmt.format(d);
}

function cdmxHour(d: Date): number {
  return Number(hourFmt.format(d)) % 24; // "24" a medianoche en algunos runtimes
}

/** offset 0 → ya; si no, las 10:00 CDMX del día enrolledAt + offset, o ya si ese instante ya pasó. */
export function computeNextRunAt(enrolledAt: Date, dayOffset: number, now: Date): Date {
  if (dayOffset <= 0) return now;
  const base = new Date(`${cdmxDay(enrolledAt)}T12:00:00${CDMX_OFFSET}`); // mediodía: sumar días sin cruzar fechas
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const at = new Date(`${cdmxDay(base)}T${String(SEND_HOUR).padStart(2, "0")}:00:00${CDMX_OFFSET}`);
  return at.getTime() <= now.getTime() ? now : at;
}

/** 08:00 ≤ hora CDMX < 20:00. */
export function inSendingWindow(now: Date): boolean {
  const h = cdmxHour(now);
  return h >= 8 && h < 20;
}

export function cadenceVars(c: { name: string; email: string | null; cityName: string | null }, ownerName: string | null): TemplateVars {
  return {
    nombre: firstName(c.name),
    nombre_completo: c.name,
    email: c.email,
    ciudad: c.cityName,
    remitente: ownerName ? firstName(ownerName) : "el equipo de Ziora",
  };
}

const UNESC: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** WhatsApp es texto plano: renderiza y deshace el escape HTML de renderTemplate. */
export function renderWhatsapp(text: string, vars: TemplateVars): string {
  return renderTemplate(text, vars).replace(/&(amp|lt|gt|quot|#39);/g, (m) => UNESC[m] ?? m);
}

export function touchLabel(touch: number, total: number, channel: "email" | "whatsapp"): string {
  return `Toque ${touch} de ${total} · ${channel === "email" ? "Correo" : "WhatsApp"}`;
}
