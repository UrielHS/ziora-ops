import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { requireEnv } from "@/lib/env";
import type { OutgoingEmail } from "@/integrations/resend";

/** Lo único que usamos del transporte: así la prueba inyecta uno falso. */
export type SmtpTransport = { sendMail(opts: Mail.Options): Promise<{ messageId?: string }> };

let transport: SmtpTransport | null = null;
/**
 * Relay SMTP de Google Workspace (el mismo que usa la app): SMTP_HOST, SMTP_PORT (587), SMTP_USERNAME, SMTP_PASSWORD.
 * Sin proveedor nuevo ni DNS extra: el dominio ziora-copilot.com ya firma con DKIM de Google.
 */
export function smtpTransport(): SmtpTransport {
  transport ??= nodemailer.createTransport({
    host: requireEnv("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    requireTLS: true,
    auth: { user: requireEnv("SMTP_USERNAME"), pass: requireEnv("SMTP_PASSWORD") },
    pool: true,
    maxConnections: 2,
  });
  return transport;
}

export function toSmtpMessage(from: string, e: OutgoingEmail): Mail.Options {
  return {
    from,
    to: e.to,
    subject: e.subject,
    html: e.html,
    replyTo: e.replyTo,
    headers: {
      "List-Unsubscribe": `<${e.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** Manda uno por uno (el relay no tiene lote). Si uno falla, lanza: el que llama registra el fallo y reintenta. */
export async function sendBatchSmtp(from: string, emails: OutgoingEmail[], t: SmtpTransport = smtpTransport()): Promise<(string | null)[]> {
  const ids: (string | null)[] = [];
  for (const e of emails) {
    try {
      const r = await t.sendMail(toSmtpMessage(from, e));
      ids.push(r.messageId ?? null);
    } catch (err) {
      throw new Error(`SMTP: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return ids;
}
