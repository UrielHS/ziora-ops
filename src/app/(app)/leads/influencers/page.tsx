import Link from "next/link";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { loadInfluencerBoard, type InfluencerRow } from "@/domain/influencers";
import { socialProfileUrl } from "@/domain/social-shared";
import { DEAL_KIND, INFLUENCER_STAGE, LEAD_STATUS } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

function Usage({ own }: { own: InfluencerRow["own"] }) {
  if (!own.registered) return <Badge tone="gray">No se ha registrado</Badge>;
  if (own.sessionsTotal < 1) return <Badge tone="amber">Registrado, sin sesiones</Badge>;
  return <Badge tone="green">{own.active ? "Activo" : "Con uso"} · {own.sessionsTotal} {own.sessionsTotal === 1 ? "sesión" : "sesiones"}</Badge>;
}

export default async function InfluencersPage() {
  await requirePagePermission("leads.view");
  const rows = await loadInfluencerBoard(db);
  const withDeal = rows.filter((r) => r.deal).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas"
        title="Influencers"
        subtitle="Qué opinaron, quién tiene acuerdo, si usan Ziora y cuánto traen con su liga de promoción."
        actions={<Link href="/leads" className="text-sm font-semibold text-teal">Volver a Leads</Link>}
      />
      {rows.length === 0 ? (
        <Empty title="Todavía no hay influencers" text="Importa la lista de influencers para verlos aquí (runbook, sección 9)." />
      ) : (
        <Card>
          <p className="px-5 pt-5 text-xs text-faint">{rows.length} influencers · {withDeal} con acuerdo</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-5 py-2 font-semibold">Influencer</th>
                  <th className="px-2 font-semibold">Seguidores</th>
                  <th className="px-2 font-semibold">Lead</th>
                  <th className="px-2 font-semibold">Etapa</th>
                  <th className="px-2 font-semibold">Usa Ziora</th>
                  <th className="px-2 font-semibold">Acuerdo</th>
                  <th className="px-2 text-right font-semibold">Clics</th>
                  <th className="px-2 text-right font-semibold">Registros</th>
                  <th className="px-2 text-right font-semibold">En prueba</th>
                  <th className="px-5 text-right font-semibold">Pagando</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const orphan = !!r.deal && !(r.own.registered && r.own.sessionsTotal >= 1);
                  return (
                    <tr key={r.contactId} className="border-b border-[#EFEDE6] align-top last:border-b-0">
                      <td className="px-5 py-2.5">
                        <Link href={`/leads/${r.contactId}`} className="block font-semibold hover:underline">{r.name}</Link>
                        <a href={socialProfileUrl(r.platform, r.handle)} target="_blank" rel="noreferrer" className="block text-xs text-muted hover:underline">@{r.handle}</a>
                        {orphan && <p className="mt-1 text-xs font-semibold text-[#B3261E]">Tiene acuerdo y no usa Ziora</p>}
                      </td>
                      <td className="px-2 text-muted">{r.followers ?? "—"}</td>
                      <td className="px-2">{r.leadStatus ? <Badge tone={LEAD_STATUS[r.leadStatus].tone}>{LEAD_STATUS[r.leadStatus].label}</Badge> : <span className="text-faint">—</span>}</td>
                      <td className="px-2">{r.stage ? INFLUENCER_STAGE[r.stage] : <span className="text-faint">Sin etapa</span>}</td>
                      <td className="px-2"><Usage own={r.own} /></td>
                      <td className="px-2">
                        {r.deal ? (
                          <>
                            <span className="block font-semibold">{DEAL_KIND[r.deal.kind as keyof typeof DEAL_KIND] ?? r.deal.kind}</span>
                            <span className="block text-xs text-muted">{r.deal.terms}</span>
                          </>
                        ) : <span className="text-faint">—</span>}
                      </td>
                      <td className="px-2 text-right">{r.promo ? r.promo.clicks : "—"}</td>
                      <td className="px-2 text-right font-semibold">
                        {r.promo ? r.promo.signups : "—"}
                        {r.invitedExtra > 0 && <span className="block text-[11px] font-normal text-muted">+{r.invitedExtra} por su invitación</span>}
                      </td>
                      <td className="px-2 text-right">{r.promo ? r.promo.inTrial : "—"}</td>
                      <td className="px-5 text-right">{r.promo ? r.promo.paying : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
