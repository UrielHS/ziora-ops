/**
 * Teléfonos en formato E.164 sin "+" (como los usa wa.me y la app de Ziora).
 * Mismas reglas que ziora-app/src/lib/whatsapp.ts: 10 dígitos se asumen de México (52);
 * se acepta un número solo si su longitud coincide con la de su prefijo. Nunca lanza: lo que no cuadra es null.
 */
const LENGTH_BY_PREFIX: [prefix: string, length: number][] = [
  ["521", 13],
  ["52", 12],
  ["1", 11],
];

export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10) digits = `52${digits}`;
  const ok = LENGTH_BY_PREFIX.some(([prefix, length]) => digits.startsWith(prefix) && digits.length === length);
  return ok ? digits : null;
}

/** Liga de WhatsApp con mensaje prellenado; sin teléfono abre el selector de contacto del usuario. */
export function waMessageLink(phoneE164: string | null | undefined, text: string): string {
  return `https://wa.me/${phoneE164 ?? ""}?text=${encodeURIComponent(text)}`;
}
