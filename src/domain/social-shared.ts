/** Constantes y utilidades puras de leads de redes, importables desde componentes de cliente (sin base de datos). */

/** Aviso (no tope duro) al pasar de este número de DMs mandados por persona en el día. */
export const DM_DAILY_WARN = 30;

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
