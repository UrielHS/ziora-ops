/**
 * Orden de listas por URL: `?orden=<columna>&dir=asc|desc`.
 * Por defecto el texto va de la A a la Z y los números y fechas de mayor a menor; los vacíos siempre al final.
 */
export type SortDir = "asc" | "desc";
export type Sort<K extends string> = { key: K; dir: SortDir };
export type SortValue = string | number | Date | null | undefined;

export function defaultDirFor<K extends string>(key: K, textKeys: readonly K[] = []): SortDir {
  return textKeys.includes(key) ? "asc" : "desc";
}

export function resolveSort<K extends string>(
  sp: { orden?: string; dir?: string },
  cfg: { keys: readonly K[]; def: K; defDir?: SortDir; textKeys?: readonly K[] },
): Sort<K> {
  const key = (cfg.keys as readonly string[]).includes(sp.orden ?? "") ? (sp.orden as K) : cfg.def;
  const fallback = key === cfg.def && cfg.defDir ? cfg.defDir : defaultDirFor(key, cfg.textKeys);
  return { key, dir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : fallback };
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

function norm(v: SortValue): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  return v;
}

/** Ordena una copia. Estable: a igual valor conserva el orden original. */
export function sortRows<T>(rows: readonly T[], dir: SortDir, get: (r: T) => SortValue): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: norm(get(r)) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((x) => x.r);
}

/** Arma `path?…` con los parámetros actuales más el cambio; los vacíos se quitan. */
export function hrefWith(path: string, current: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const p = new URLSearchParams(Object.entries({ ...current, ...patch }).filter(([, v]) => v) as [string, string][]);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/** «98.8K» → 98800, «1.2M» → 1200000, «5,233» → 5233. Sin número → null. */
export function parseCount(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.trim().toLowerCase().replace(/\s/g, "").match(/^([\d.,]+)([km])?/);
  if (!m) return null;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  // Con sufijo, la coma o el punto son decimales («98,8K»); sin sufijo son miles («5,233»).
  const num = m[2] ? Number(m[1].replace(",", ".")) : Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(num) ? Math.round(num * mult) : null;
}

/** El dato de seguidores solo si es una cifra («98.8K»); una nota suelta («IG citado en…») no se muestra como número. */
export function countLabel(s: string | null | undefined): string | null {
  return parseCount(s) === null ? null : s!.trim();
}
