/** Constantes y utilidades puras de leads de redes, importables desde componentes de cliente (sin base de datos). */

/** Aviso (no tope duro) al pasar de este número de DMs mandados por persona en el día. */
export const DM_DAILY_WARN = 30;

/** Textos de «siguiente acción» que pone el registro de DMs (solo estos se limpian solos; nunca una acción puesta a mano). */
export const DM_NEXT_ACTIONS = ["Seguimiento 1 por DM", "Último seguimiento por DM", "Sin respuesta tras 3 mensajes: decidir si se marca perdido"] as const;

/** ¿Todavía tiene sentido escribirle por DM? Solo mientras el lead es nuevo o contactado (sin respuesta). */
export function dmOpen(leadStatus: string | null | undefined): boolean {
  return !leadStatus || leadStatus === "nuevo" || leadStatus === "contactado";
}

export function socialProfileUrl(platform: "instagram" | "tiktok", handle: string): string {
  return platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}/`;
}

/** Influencers: etapas, transiciones y si ya usa Ziora (puro, sirve en cliente y servidor). */
export type InfluencerStage = "opinion_recibida" | "quiere_promover" | "acuerdo_cerrado" | "no_promueve";
export type DealKind = "comision" | "pago_contenido" | "otro";

const MOVES: Record<InfluencerStage | "none", InfluencerStage[]> = {
  none: ["opinion_recibida", "quiere_promover", "no_promueve"],
  opinion_recibida: ["quiere_promover", "no_promueve"],
  quiere_promover: ["acuerdo_cerrado", "no_promueve"],
  no_promueve: ["quiere_promover"],
  acuerdo_cerrado: [],
};

export function canMoveStage(from: InfluencerStage | null, to: InfluencerStage): boolean {
  return MOVES[from ?? "none"].includes(to);
}

/** Cuenta viva con al menos una sesión. */
export function usesZiora(u: { sessionsTotal: number; removedAt: Date | null } | null | undefined): boolean {
  return !!u && !u.removedAt && u.sessionsTotal >= 1;
}
