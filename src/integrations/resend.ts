import { Resend } from "resend";
import { requireEnv } from "@/lib/env";

let client: Resend | null = null;
export function resend(): Resend {
  client ??= new Resend(requireEnv("RESEND_API_KEY"));
  return client;
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  unsubscribeUrl: string;
  tags?: { name: string; value: string }[];
  /** A quién llegan las respuestas (el dominio de envío mail.* no recibe correo). */
  replyTo?: string;
};

/** Envía hasta 100 correos en una llamada. Devuelve el id del proveedor por posición. */
export async function sendBatch(from: string, emails: OutgoingEmail[]): Promise<(string | null)[]> {
  if (emails.length === 0) return [];
  if (emails.length > 100) throw new Error("Resend batch admite máximo 100 correos por llamada");
  const { data, error } = await resend().batch.send(
    emails.map((e) => ({
      from,
      to: [e.to],
      subject: e.subject,
      html: e.html,
      tags: e.tags,
      replyTo: e.replyTo,
      headers: {
        "List-Unsubscribe": `<${e.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    })),
  );
  if (error) throw new Error(`Resend: ${error.message}`);
  const ids = (data as { data?: { id: string }[] } | null)?.data ?? [];
  return emails.map((_, i) => ids[i]?.id ?? null);
}
