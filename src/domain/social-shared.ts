/** Constantes y utilidades puras de leads de redes, importables desde componentes de cliente (sin base de datos). */

/** Aviso (no tope duro) al pasar de este número de DMs mandados por persona en el día. */
export const DM_DAILY_WARN = 30;

export function socialProfileUrl(platform: "instagram" | "tiktok", handle: string): string {
  return platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}/`;
}
