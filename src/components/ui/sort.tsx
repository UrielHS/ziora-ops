"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "@/lib/sort";
import { cn } from "./index";

const ariaSort = (on: boolean, dir: SortDir) => (on ? (dir === "asc" ? "ascending" : "descending") : "none") as "ascending" | "descending" | "none";

function useSortHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (orden: string, dir: SortDir) => {
    const p = new URLSearchParams(params.toString());
    p.set("orden", orden);
    p.set("dir", dir);
    p.delete("page");
    p.delete("p");
    return `${pathname}?${p}`;
  };
}

/**
 * Encabezado de tabla ordenable. Primer clic: ordena por esa columna en su sentido natural
 * (texto A→Z, números y fechas de mayor a menor); el segundo invierte.
 */
export function SortTh({ k, label, current, dir, naturalDir = "desc", align, className }: {
  k: string; label: React.ReactNode; current: string; dir: SortDir; naturalDir?: SortDir; align?: "right"; className?: string;
}) {
  const href = useSortHref();
  const on = current === k;
  const next: SortDir = on ? (dir === "asc" ? "desc" : "asc") : naturalDir;
  const Icon = on ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th aria-sort={ariaSort(on, dir)} className={cn("whitespace-nowrap px-2 py-2 font-semibold", align === "right" && "text-right", className)}>
      <Link href={href(k, next)} scroll={false} title={`Ordenar por ${typeof label === "string" ? label.toLowerCase() : "esta columna"}`}
        className={cn("inline-flex items-center gap-1 hover:text-ink", on && "text-ink", align === "right" && "flex-row-reverse")}>
        {label}<Icon className={cn("h-3 w-3 shrink-0", on ? "text-emerald" : "text-faint")} />
      </Link>
    </th>
  );
}

/** Igual que SortTh pero para encabezados hechos con grid (sin <table>). */
export function SortLabel({ k, label, current, dir, naturalDir = "desc", className }: {
  k: string; label: string; current: string; dir: SortDir; naturalDir?: SortDir; className?: string;
}) {
  const href = useSortHref();
  const on = current === k;
  const next: SortDir = on ? (dir === "asc" ? "desc" : "asc") : naturalDir;
  const Icon = on ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <Link href={href(k, next)} scroll={false} aria-label={on ? `${label}, orden ${dir === "asc" ? "ascendente" : "descendente"}; cambiar` : `Ordenar por ${label.toLowerCase()}`}
      className={cn("label inline-flex items-center gap-1 whitespace-nowrap hover:text-ink", on && "text-ink", className)}>
      {label}<Icon className={cn("h-3 w-3 shrink-0", on ? "text-emerald" : "text-faint")} />
    </Link>
  );
}

/** «Ordenar por [campo] [↑/↓]» para tableros y listas sin encabezados (kanban, Mi día, comunidades). */
export function SortControl({ options, current, dir, textKeys = [], defaultLabel }: {
  options: readonly (readonly [string, string])[]; current: string; dir: SortDir; textKeys?: readonly string[];
  /** Si se da, agrega el orden por defecto (sin ?orden); `current` vacío lo deja elegido. */
  defaultLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const href = useSortHref();
  const go = (k: string, d: SortDir) => {
    if (!k) {
      const p = new URLSearchParams(params.toString());
      p.delete("orden");
      p.delete("dir");
      const qs = p.toString();
      return router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    router.push(href(k, d), { scroll: false });
  };
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        Ordenar por
        <select value={current} onChange={(e) => go(e.target.value, textKeys.includes(e.target.value) ? "asc" : "desc")}
          className="rounded-full border border-line bg-white py-1.5 pl-3 pr-7 text-xs text-ink outline-none focus:border-emerald focus:ring-2 focus:ring-mint">
          {defaultLabel !== undefined && <option value="">{defaultLabel}</option>}
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {current && <button type="button" onClick={() => go(current, dir === "asc" ? "desc" : "asc")}
        aria-label={dir === "asc" ? "Orden ascendente; cambiar a descendente" : "Orden descendente; cambiar a ascendente"}
        title={dir === "asc" ? "Ascendente (A→Z, menor a mayor)" : "Descendente (Z→A, mayor a menor)"}
        className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-ink">
        {dir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-emerald" /> : <ArrowDown className="h-3.5 w-3.5 text-emerald" />}
        {dir === "asc" ? "Asc" : "Desc"}
      </button>}
    </div>
  );
}
