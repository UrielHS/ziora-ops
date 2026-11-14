import type { contacts } from "@/db/schema";
import { CITY } from "@/lib/labels";
import { parseCount, resolveSort, sortRows, type Sort, type SortValue } from "@/lib/sort";
import { LEAD_ORDER } from "./leads";

type Lead = typeof contacts.$inferSelect;

/** Columnas por las que se ordenan los leads (tablero, lista y Mi día). */
export const LEAD_SORT_KEYS = ["prioridad", "nombre", "estado", "dueno", "ciudad", "seguidores", "siguiente", "contacto", "alta"] as const;
export type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];
export const LEAD_SORT_TEXT: readonly LeadSortKey[] = ["prioridad", "nombre", "estado", "dueno", "ciudad", "siguiente"];
export const LEAD_SORT_OPTIONS: readonly (readonly [LeadSortKey, string])[] = [
  ["prioridad", "Prioridad"], ["nombre", "Nombre"], ["estado", "Etapa"], ["dueno", "Dueño"], ["ciudad", "Ciudad"],
  ["seguidores", "Seguidores"], ["siguiente", "Siguiente paso"], ["contacto", "Último contacto"], ["alta", "Fecha de alta"],
];

export function resolveLeadSort(sp: { orden?: string; dir?: string }): Sort<LeadSortKey> {
  // Prioridad y siguiente paso: «asc» = lo más urgente primero (Alta, fecha más próxima).
  return resolveSort(sp, { keys: LEAD_SORT_KEYS, def: "prioridad", textKeys: LEAD_SORT_TEXT });
}

const STAGE_INDEX = (s: Lead["leadStatus"]) => (s === "perdido" ? LEAD_ORDER.length : s ? LEAD_ORDER.indexOf(s) : null);

export function leadSortValue(c: Lead, key: LeadSortKey, ownerName: (id: string | null) => string | null): SortValue {
  switch (key) {
    case "prioridad": return c.priority;
    case "nombre": return c.name;
    case "estado": return STAGE_INDEX(c.leadStatus);
    case "dueno": return ownerName(c.ownerId);
    case "ciudad": return c.cityName ?? (c.city ? CITY[c.city] : null);
    case "seguidores": return parseCount(c.socialFollowers);
    case "siguiente": return c.nextActionOn;
    case "contacto": return c.lastContactAt;
    case "alta": return c.createdAt;
  }
}

export function sortLeads(rows: readonly Lead[], sort: Sort<LeadSortKey>, ownerName: (id: string | null) => string | null): Lead[] {
  return sortRows(rows, sort.dir, (c) => leadSortValue(c, sort.key, ownerName));
}
