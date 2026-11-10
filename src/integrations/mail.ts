import { resend, sendBatch as sendBatchResend, type OutgoingEmail } from "@/integrations/resend";
import { sendBatchSmtp, smtpTransport } from "@/integrations/smtp";

export type { OutgoingEmail };
export type MailTransport = "smtp" | "resend";

/** SMTP (relay de Workspace) manda si está configurado; Resend queda como alternativa. */
export function mailTransport(env: Record<string, string | undefined> = process.env): MailTransport | null {
  if (env.SMTP_HOST) return "smtp";
  if (env.RESEND_API_KEY) return "resend";
  return null;
}
export const mailConfigured = () => mailTransport() !== null;

/** Envía hasta 100 correos. Devuelve el id del proveedor por posición. */
export async function sendBatch(from: string, emails: OutgoingEmail[]): Promise<(string | null)[]> {
  const t = mailTransport();
  if (t === "smtp") return sendBatchSmtp(from, emails);
  if (t === "resend") return sendBatchResend(from, emails);
  throw new Error("Missing environment variable: SMTP_HOST (o RESEND_API_KEY)");
}

/** Correo interno (avisos al equipo): sin liga de baja. */
export async function sendOne(from: string, to: string[], subject: string, html: string): Promise<void> {
  const t = mailTransport();
  if (t === "smtp") { await smtpTransport().sendMail({ from, to, subject, html }); return; }
  if (t === "resend") { await resend().emails.send({ from, to, subject, html }); return; }
  throw new Error("Missing environment variable: SMTP_HOST (o RESEND_API_KEY)");
}
