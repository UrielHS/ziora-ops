/** Dominio del equipo. Solo estas cuentas de Google pueden entrar a Ziora Ops (decisión de Chris, 10-nov-2026). */
export const TEAM_EMAIL_DOMAIN = "ziora-copilot.com";

/** Entra solo el equipo: el correo debe ser exactamente alguien@ziora-copilot.com. Además sigue aplicando la lista de Event Ops (public.users activo). */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 && e.slice(at + 1) === TEAM_EMAIL_DOMAIN;
}
