/** Calendario del plan de 90 días (docs/gtm/2026-11-09-plan-90-dias-equipo.md). Sin dependencias de base de datos. */
export const GTM_START = "2026-11-09"; // semana 1 del plan de 90 días (antes: 2026-10-12, brief de octubre)
export const GTM_WEEKS = 12;
const CDMX = "-06:00";

export function gtmDay(now = new Date()) {
  return Math.floor((now.getTime() - new Date(`${GTM_START}T00:00:00${CDMX}`).getTime()) / 86_400_000) + 1;
}
export function gtmPhase(day = gtmDay()): "d30" | "d60" | "d90" {
  return day <= 30 ? "d30" : day <= 60 ? "d60" : "d90";
}
/** «Semana N de 12 del plan de 90 días», o null fuera del plan. */
export function gtmWeekLabel(now = new Date()): string | null {
  const day = gtmDay(now);
  if (day < 1) return null;
  const week = Math.ceil(day / 7);
  return week <= GTM_WEEKS ? `Semana ${week} de ${GTM_WEEKS} del plan de 90 días` : null;
}
