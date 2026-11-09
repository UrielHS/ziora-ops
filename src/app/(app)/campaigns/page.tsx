import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Badge, btn, Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { campaigns, campaignSends, emailTemplates } from "@/db/schema";
import { events } from "@/db/shared";
import { resolveRecipients } from "@/domain/campaigns";
import { fmtDate, fmtDateTime, pct } from "@/lib/format";
import { CAMPAIGN_STATUS, CITY, CONTACT_TAG } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  await requirePagePermission("content.manage");
  const rows = await db
    .select({
      c: campaigns, template: emailTemplates.name, tSubject: emailTemplates.subject, event: events.name,
      sent: sql<number>`count(${campaignSends.id}) filter (where ${campaignSends.status} not in ('queued','failed','skipped'))::int`,
      opened: sql<number>`count(${campaignSends.id}) filter (where ${campaignSends.status} in ('opened','clicked'))::int`,
      clicked: sql<number>`count(${campaignSends.id}) filter (where ${campaignSends.status} = 'clicked')::int`,
      bounced: sql<number>`count(${campaignSends.id}) filter (where ${campaignSends.status} in ('bounced','complained'))::int`,
    })
    .from(campaigns)
    .innerJoin(emailTemplates, eq(emailTemplates.id, campaigns.templateId))
    .leftJoin(events, eq(events.id, campaigns.eventId))
    .leftJoin(campaignSends, eq(campaignSends.campaignId, campaigns.id))
    .groupBy(campaigns.id, emailTemplates.name, emailTemplates.subject, events.name)
    .orderBy(desc(campaigns.createdAt));
  const pending = await Promise.all(rows.map((r) => (r.c.status === "sent" ? Promise.resolve(null) : resolveRecipients(db, r.c.id).then((x) => x.length))));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing"
        title="Campañas de correo"
        subtitle="Solo llegan a contactos con permiso vigente. Cada correo lleva baja de un clic."
        actions={<><Link href="/templates" className={btn("ghost")}>Plantillas</Link><Link href="/campaigns/new" className={btn()}>+ Campaña</Link></>}
      />
      <Card>
        {rows.length === 0 && <p className="p-6 text-sm text-muted">Sin campañas todavía.</p>}
        {rows.map((r, i) => {
          const seg = r.c.segment;
          const segText = [
            ...(seg.tags ?? []).map((t) => CONTACT_TAG[t] ?? t), ...(seg.cities ?? []).map((c) => CITY[c as keyof typeof CITY] ?? c),
            r.event ? `Invitados: ${r.event}` : null,
          ].filter(Boolean).join(" · ") || "Todos con permiso";
          return (
            <Link key={r.c.id} href={`/campaigns/${r.c.id}`} className="grid grid-cols-1 gap-2 border-b border-[#EFEDE6] px-5 py-4 last:border-b-0 hover:bg-[#FBFAF6] md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_auto] md:items-center md:gap-4">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{r.c.name}</span>
                <span className="block truncate text-xs text-muted">{r.c.subject ?? r.tSubject} · {r.template}</span>
              </span>
              <span className="truncate text-xs text-muted">{segText}</span>
              <span className="text-xs">
                {r.c.status === "sent" ? (
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
                    <b className="text-ink">{r.sent}</b> enviados
                    <span><b className="text-ink">{pct(r.opened, r.sent)}%</b> apertura</span>
                    <span><b className="text-ink">{pct(r.clicked, r.sent)}%</b> clic</span>
                    {r.bounced > 0 && <span className="text-danger">{r.bounced} rebotes</span>}
                  </span>
                ) : (
                  <span className="text-muted"><b className="text-ink">{pending[i]}</b> destinatarios con permiso</span>
                )}
              </span>
              <span className="flex items-center gap-2 md:justify-end">
                <Badge tone={CAMPAIGN_STATUS[r.c.status].tone}>{CAMPAIGN_STATUS[r.c.status].label}</Badge>
                <span className="whitespace-nowrap text-[11px] text-faint">
                  {r.c.sentAt ? fmtDate(r.c.sentAt) : r.c.scheduledAt ? fmtDateTime(r.c.scheduledAt) : fmtDate(r.c.createdAt)}
                </span>
              </span>
            </Link>
          );
        })}
      </Card>
    </div>
  );
}
