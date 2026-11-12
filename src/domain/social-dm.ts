import type { SocialLeadType, SocialPlatform } from "./social-leads";

/** Llaves de los mensajes de DM por tipo de lead y paso (1 = primer contacto, 2 = a los 4 días, 3 = a los 7). */
export const DM_KEYS = {
  psicologo: ["RP1", "RP2", "RP3"],
  influencer: ["RI1", "RI2", "RI3"],
} as const;

/** Paso que toca según los DMs ya mandados; `null` si ya se mandaron los tres. */
export function dmStep(sent: number): 1 | 2 | 3 | null {
  if (!Number.isInteger(sent) || sent < 0 || sent > 2) return null;
  return (sent + 1) as 1 | 2 | 3;
}

const PLATFORM_LABEL: Record<SocialPlatform, string> = { instagram: "Instagram", tiktok: "TikTok" };

export function renderDm(body: string, v: { nombre: string; yo: string; liga: string; red: string }): string {
  return body.replaceAll("{nombre}", v.nombre).replaceAll("{yo}", v.yo).replaceAll("{liga}", v.liga).replaceAll("{red}", v.red);
}

/** Mensaje que toca para este lead. `text: null` = ese mensaje no está aprobado; `null` = ya no hay más pasos. */
export function dmFor(
  lead: { name: string; socialLeadType: SocialLeadType | null; socialPlatform: SocialPlatform | null },
  sent: number,
  messages: { key: string; body: string; status: string }[],
  v: { yo: string; liga: string },
): { key: string; step: 1 | 2 | 3; text: string | null } | null {
  const step = dmStep(sent);
  if (!step) return null;
  const key = DM_KEYS[lead.socialLeadType ?? "psicologo"][step - 1];
  const m = messages.find((x) => x.key === key);
  if (!m || m.status !== "aprobado") return { key, step, text: null };
  const red = lead.socialPlatform ? PLATFORM_LABEL[lead.socialPlatform] : "redes";
  return { key, step, text: renderDm(m.body, { nombre: lead.name, yo: v.yo, liga: v.liga, red }) };
}
