import { mailConfigured, sendOne } from "@/integrations/mail";

/**
 * Aviso interno al equipo (revisiones pendientes, sugerencias decididas…).
 * No es correo de marketing: no lleva baja. Si el correo no está configurado (SMTP o Resend), solo se registra en el log.
 */
export async function notifyTeam(to: string[], subject: string, lines: string[], link?: { href: string; label: string }) {
  const recipients = [...new Set(to.filter(Boolean))];
  if (recipients.length === 0) return;
  if (!mailConfigured()) {
    console.info(`[aviso sin enviar: falta SMTP_HOST o RESEND_API_KEY] ${subject} → ${recipients.join(", ")}`);
    return;
  }
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const url = link ? `${process.env.APP_URL ?? ""}${link.href}` : null;
  const html = [
    `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1E1E1E">`,
    ...lines.map((l) => `<p>${esc(l)}</p>`),
    url ? `<p><a href="${esc(url)}" style="color:#059669;font-weight:600">${esc(link!.label)} ↗</a></p>` : "",
    `<p style="color:#9CA3AF;font-size:12px">Ziora Ops</p></div>`,
  ].join("");
  try {
    await sendOne(process.env.MAIL_FROM ?? "Ziora Ops <ops@ziora-copilot.com>", recipients, subject, html);
  } catch (err) {
    // Un aviso que falla no debe tumbar la acción del usuario.
    console.error("notifyTeam", err);
  }
}
