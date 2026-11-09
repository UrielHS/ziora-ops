import { normalizePhoneE164 } from "@/domain/phone";
const TZ = "America/Mexico_City";

export function fmtDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00` : d) : d;
  return new Intl.DateTimeFormat("es-MX", { timeZone: TZ, ...opts }).format(date);
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fmtDateTime(d: Date | string | null | undefined) {
  return fmtDate(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function relative(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (Date.now() - date.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export function initials(name: string) {
  return name.replace(/^(psic\.?|dra?\.?|lic\.?)\s+/i, "").split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function waLink(phone: string | null | undefined, text?: string) {
  const e164 = normalizePhoneE164(phone);
  if (!e164) return null;
  return `https://wa.me/${e164}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

export function money(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}
