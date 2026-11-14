import Link from "next/link";
import type { Tone } from "@/lib/labels";
import { initials } from "@/lib/format";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const TONES: Record<Tone, string> = {
  green: "bg-mint text-emerald",
  gray: "bg-[#F1F0EA] text-muted",
  amber: "bg-warn-bg text-warn",
  red: "bg-danger-bg text-danger",
  blue: "bg-[#E6F0FB] text-[#1D5FA8]",
  lilac: "bg-[#F0EBFA] text-[#6B4FA8]",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("pill whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("card", className)}>{children}</section>;
}

export function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div>
        <h2 className="text-[15px] font-bold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ViewAll({ href, label = "Ver todo" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="whitespace-nowrap rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-muted hover:text-ink">
      {label} ↗
    </Link>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    // Las acciones no se encogen ni se parten en renglones sueltos: el subtítulo es el que se ajusta.
    // Debajo de lg (o con poco espacio) pasan abajo del título, alineadas a la izquierda.
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
      <div className="min-w-0 lg:flex-1">
        {eyebrow && <p className="label mb-1">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:max-w-[55%] lg:shrink-0 lg:justify-end">{actions}</div>}
    </header>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function btn(variant: BtnVariant = "primary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors disabled:opacity-50 cursor-pointer",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
    variant === "primary" && "bg-forest text-white hover:bg-forest-hover",
    variant === "secondary" && "border border-forest/70 text-teal hover:bg-mint",
    variant === "ghost" && "border border-line bg-white text-muted hover:text-ink",
    variant === "danger" && "border border-danger/30 text-danger hover:bg-danger-bg",
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-emerald focus:ring-2 focus:ring-mint";

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function Select({
  name, options, defaultValue, placeholder, className,
}: {
  name: string;
  options: readonly (readonly [string, string])[] | [string, string][];
  defaultValue?: string | null;
  placeholder?: string;
  className?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className={cn(className?.includes("w-") ? inputCls.replace("w-full ", "") : inputCls, "pr-8", className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

export function Progress({ value, max, tone = "green", className }: { value: number; max: number; tone?: "green" | "amber" | "red"; className?: string }) {
  const p = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[#EDEBE3]", className)}>
      <div
        className={cn("h-full rounded-full", tone === "green" && "bg-emerald", tone === "amber" && "bg-[#D99A2B]", tone === "red" && "bg-danger")}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

const AVATAR_COLORS = ["#CFEADE", "#E6F0FB", "#F0EBFA", "#FDF4E3", "#FDECEC", "#E2F3EC"];
export function Avatar({ name, size = 24 }: { name?: string | null; size?: number }) {
  if (!name) return <span className="grid place-items-center rounded-full border border-dashed border-line text-[10px] text-faint" style={{ width: size, height: size }}>?</span>;
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span title={name} className="grid shrink-0 place-items-center rounded-full font-bold text-teal" style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="hero-gradient relative overflow-hidden rounded-2xl px-6 py-10 text-center">
      <p className="relative font-bold text-teal">{title}</p>
      {text && <p className="relative mx-auto mt-1 max-w-md text-sm text-[#4F6F5F]">{text}</p>}
      {action && <div className="relative mt-4">{action}</div>}
    </div>
  );
}

export function Kpi({
  label, value, note, icon: Icon, highlight, href,
}: {
  label: string; value: React.ReactNode; note?: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; highlight?: boolean; href?: string;
}) {
  const body = (
    <div className={cn("card h-full p-4 transition-colors", highlight && "border-emerald/40 bg-mint", href && "hover:border-emerald/40")}>
      <div className="flex items-start justify-between gap-2">
        <p className="label leading-tight">{label}</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-white">
          <Icon className="h-4 w-4 text-muted" strokeWidth={1.6} />
        </span>
      </div>
      <p className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0", className)}>{children}</div>;
}
