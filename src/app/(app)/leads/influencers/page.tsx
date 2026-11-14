import Link from "next/link";
import { Badge, btn, Card, cn, Empty, inputCls, PageHeader, Select } from "@/components/ui";
import { SortTh } from "@/components/ui/sort";
import { db } from "@/db";
import { listUsers, userOptions } from "@/db/queries";
import { loadInfluencerBoard, type InfluencerRow } from "@/domain/influencers";
import { socialProfileUrl } from "@/domain/social-shared";
import { LEAD_ORDER } from "@/domain/leads";
import { DEAL_KIND, INFLUENCER_STAGE, LEAD_STATUS } from "@/lib/labels";
import { countLabel, hrefWith, parseCount, resolveSort, sortRows, type SortValue } from "@/lib/sort";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

type SP = { q?: string; etapa?: string; estado?: string; uso?: string; acuerdo?: string; dueno?: string; orden?: string; dir?: string };

const USE = { no: "No se ha registrado", registrado: "Registrado, sin sesiones", usa: "Usa Ziora" } as const;
const useOf = (own: InfluencerRow["own"]): keyof typeof USE => (!own.registered ? "no" : own.sessionsTotal < 1 ? "registrado" : "usa");

const SORT_KEYS = ["nombre", "seguidores", "estado", "etapa", "uso", "acuerdo", "clics", "registros", "prueba", "pagando"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const TEXT_KEYS: readonly SortKey[] = ["nombre", "estado", "etapa", "acuerdo"];
const STAGE_ORDER = ["opinion_recibida", "quiere_promover", "acuerdo_cerrado", "no_promueve"] as const;

function value(r: InfluencerRow, k: SortKey): SortValue {
  switch (k) {
    case "nombre": return r.name;
    case "seguidores": return parseCount(r.followers);
    case "estado": return r.leadStatus ? (r.leadStatus === "perdido" ? LEAD_ORDER.length : LEAD_ORDER.indexOf(r.leadStatus)) : null;
    case "etapa": return r.stage ? STAGE_ORDER.indexOf(r.stage) : null;
    case "uso": return r.own.registered ? r.own.sessionsTotal + 1 : 0;
    case "acuerdo": return r.deal ? DEAL_KIND[r.deal.kind as keyof typeof DEAL_KIND] ?? r.deal.kind : null;
    case "clics": return r.promo?.clicks ?? null;
    case "registros": return r.promo ? r.promo.signups + r.invitedExtra : r.invitedExtra || null;
    case "prueba": return r.promo?.inTrial ?? null;
    case "pagando": return r.promo?.paying ?? null;
  }
}

function Usage({ own }: { own: InfluencerRow["own"] }) {
  if (!own.registered) return <Badge tone="gray">No se ha registrado</Badge>;
  if (own.sessionsTotal < 1) return <Badge tone="amber">Registrado, sin sesiones</Badge>;
  return <Badge tone="green">{own.active ? "Activo" : "Con uso"} · {own.sessionsTotal} {own.sessionsTotal === 1 ? "sesión" : "sesiones"}</Badge>;
}

export default async function InfluencersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("leads.view");
  const sp = await searchParams;
  const [all, users] = await Promise.all([loadInfluencerBoard(db), listUsers()]);
  const withDeal = all.filter((r) => r.deal).length;

  const q = sp.q?.trim().toLowerCase();
  const filtered = all.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.handle.toLowerCase().includes(q))
    && (!sp.etapa || (sp.etapa === "sin" ? !r.stage : r.stage === sp.etapa))
    && (!sp.estado || r.leadStatus === sp.estado)
    && (!sp.uso || useOf(r.own) === sp.uso)
    && (!sp.acuerdo || (sp.acuerdo === "si") === !!r.deal)
    && (!sp.dueno || (sp.dueno === "ninguno" ? !r.ownerId : r.ownerId === sp.dueno)));
  // Sin orden elegido: como antes (con acuerdo primero, luego por registros de su liga).
  const sort = resolveSort(sp, { keys: SORT_KEYS, def: "registros", textKeys: TEXT_KEYS });
  const rows = sp.orden ? sortRows(filtered, sort.dir, (r) => value(r, sort.key)) : filtered;
  const filtering = (["q", "etapa", "estado", "uso", "acuerdo", "dueno"] as const).some((k) => sp[k]);
  const th = (k: SortKey, label: string, align?: "right", className?: string) => (
    <SortTh k={k} label={label} current={sp.orden ? sort.key : ""} dir={sort.dir} naturalDir={TEXT_KEYS.includes(k) ? "asc" : "desc"} align={align} className={className} />
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas"
        title="Influencers"
        subtitle="Qué opinaron, quién tiene acuerdo, si usan Ziora y cuánto traen con su liga de promoción."
        actions={<Link href="/leads?redes=influencer&todos=1" className={btn("ghost", "sm")}>Ver en Leads</Link>}
      />

      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Nombre o @usuario" aria-label="Buscar influencer" className={cn(inputCls, "w-56 rounded-full py-1.5")} />
        <Select name="etapa" defaultValue={sp.etapa} placeholder="Toda etapa" className="w-auto rounded-full py-1.5 text-xs" options={[["sin", "Sin etapa"], ...Object.entries(INFLUENCER_STAGE)]} />
        <Select name="estado" defaultValue={sp.estado} placeholder="Todo estado del lead" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(LEAD_STATUS).map(([k, v]) => [k, v.label])} />
        <Select name="uso" defaultValue={sp.uso} placeholder="Uso de Ziora: todos" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(USE)} />
        <Select name="acuerdo" defaultValue={sp.acuerdo} placeholder="Con y sin acuerdo" className="w-auto rounded-full py-1.5 text-xs" options={[["si", "Con acuerdo"], ["no", "Sin acuerdo"]]} />
        <Select name="dueno" defaultValue={sp.dueno} placeholder="Cualquier dueño" className="w-auto rounded-full py-1.5 text-xs" options={[["ninguno", "Sin dueño"], ...userOptions(users)]} />
        {sp.orden && <input type="hidden" name="orden" value={sp.orden} />}
        {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
        <button className={btn("ghost", "sm")}>Filtrar</button>
        {filtering && <Link href={hrefWith("/leads/influencers", {}, { orden: sp.orden, dir: sp.dir })} className="text-xs text-muted underline">Limpiar filtros</Link>}
      </form>

      {all.length === 0 ? (
        <Empty title="Todavía no hay influencers" text="Importa la lista de influencers para verlos aquí (runbook, sección 9)." />
      ) : (
        <Card>
          <p className="px-5 pt-5 text-xs text-muted">
            {rows.length === all.length ? `${all.length} influencers` : `${rows.length} de ${all.length} influencers`} · {withDeal} con acuerdo
            <span className="ml-2 text-faint 2xl:hidden">Desliza la tabla a la derecha para ver todas las columnas →</span>
          </p>
          {rows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Nadie coincide con estos filtros.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                    {th("nombre", "Influencer", undefined, "sticky left-0 z-10 bg-white px-5")}
                    {th("seguidores", "Seguidores", "right")}
                    {th("estado", "Lead")}
                    {th("etapa", "Etapa")}
                    {th("uso", "Usa Ziora")}
                    {th("acuerdo", "Acuerdo")}
                    {th("clics", "Clics", "right")}
                    {th("registros", "Registros", "right")}
                    {th("prueba", "En prueba", "right")}
                    {th("pagando", "Pagando", "right", "pr-5")}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const orphan = !!r.deal && !(r.own.registered && r.own.sessionsTotal >= 1);
                    return (
                      <tr key={r.contactId} className="group border-b border-[#EFEDE6] align-top last:border-b-0 hover:bg-[#FBFAF6]">
                        {/* Primera columna fija: al deslizar la tabla siempre se ve de quién es la fila. */}
                        <td className="sticky left-0 z-10 max-w-[240px] bg-white px-5 py-2.5 group-hover:bg-[#FBFAF6]">
                          <Link href={`/leads/${r.contactId}`} className="block truncate font-semibold hover:underline">{r.name}</Link>
                          <a href={socialProfileUrl(r.platform, r.handle)} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted hover:underline">@{r.handle}</a>
                          {orphan && <p className="mt-1 text-xs font-semibold text-[#B3261E]">Tiene acuerdo y no usa Ziora</p>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right text-muted">{countLabel(r.followers) ?? "—"}</td>
                        <td className="px-2 py-2.5">{r.leadStatus ? <Badge tone={LEAD_STATUS[r.leadStatus].tone}>{LEAD_STATUS[r.leadStatus].label}</Badge> : <span className="text-faint">—</span>}</td>
                        <td className="whitespace-nowrap px-2 py-2.5">{r.stage ? INFLUENCER_STAGE[r.stage] : <span className="text-faint">Sin etapa</span>}</td>
                        <td className="px-2 py-2.5"><Usage own={r.own} /></td>
                        <td className="px-2 py-2.5">
                          {r.deal ? (
                            <>
                              <span className="block whitespace-nowrap font-semibold">{DEAL_KIND[r.deal.kind as keyof typeof DEAL_KIND] ?? r.deal.kind}</span>
                              <span className="block text-xs text-muted">{r.deal.terms}</span>
                            </>
                          ) : <span className="text-faint">—</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right">{r.promo ? r.promo.clicks : "—"}</td>
                        <td className="px-2 py-2.5 text-right font-semibold">
                          {r.promo ? r.promo.signups : "—"}
                          {r.invitedExtra > 0 && <span className="block text-[11px] font-normal text-muted">+{r.invitedExtra} por su invitación</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right">{r.promo ? r.promo.inTrial : "—"}</td>
                        <td className="px-2 py-2.5 pr-5 text-right">{r.promo ? r.promo.paying : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
