import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { deleteDraftCampaign, sendCampaignNow } from "@/actions/campaigns";
import { Badge, btn, Card, PageHeader, PanelHeader, Progress } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { campaigns, campaignSends, emailTemplates } from "@/db/schema";
import { events } from "@/db/shared";
import { resolveRecipients } from "@/domain/campaigns";
import { renderTemplate } from "@/domain/template";
import { fmtDate, fmtDateTime, pct } from "@/lib/format";
import { CAMPAIGN_STATUS, CITY, CONTACT_SOURCE, CONTACT_TAG, SEND_STATUS } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("content.manage");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [row] = await db.select({ c: campaigns, t: emailTemplates }).from(campaigns).innerJoin(emailTemplates, eq(emailTemplates.id, campaigns.templateId)).where(eq(campaigns.id, id));
  if (!row) notFound();
  const { c, t } = row;
  const [event] = c.eventId ? await db.select().from(events).where(eq(events.id, c.eventId)) : [];
  const [recipients, byStatus, sends] = await Promise.all([
    resolveRecipients(db, id),
    db.select({ status: campaignSends.status, n: count() }).from(campaignSends).where(eq(campaignSends.campaignId, id)).groupBy(campaignSends.status),
    db.select().from(campaignSends).where(eq(campaignSends.campaignId, id)).orderBy(desc(campaignSends.updatedAt)).limit(30),
  ]);
  const n = (...s: string[]) => byStatus.filter((b) => s.includes(b.status)).reduce((a, b) => a + b.n, 0);
  const sent = n("sent", "delivered", "opened", "clicked", "bounced", "complained");
  const sample = recipients[0];
  const vars = { nombre: sample?.name.split(" ").find((p) => !/^(psic|dra?|lic)\.?$/i.test(p)) ?? "Andrea", nombre_completo: sample?.name, ciudad: sample?.city, evento: event?.name, evento_fecha: event?.date, evento_registro: event?.registrationUrl, baja: "#baja" };
  const seg = c.segment;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Campaña"
        title={c.name}
        subtitle={`Plantilla: ${t.name}${event ? ` · Evento: ${event.name}` : ""}`}
        actions={<><Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge><Link href="/campaigns" className="text-sm text-muted underline">Volver</Link></>}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <p className="label">Segmento</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(seg.tags ?? []).map((x) => <Badge key={x} tone="green">{CONTACT_TAG[x] ?? x}</Badge>)}
              {(seg.cities ?? []).map((x) => <Badge key={x} tone="blue">{CITY[x as keyof typeof CITY] ?? x}</Badge>)}
              {(seg.sources ?? []).map((x) => <Badge key={x}>{CONTACT_SOURCE[x] ?? x}</Badge>)}
              {event && <Badge tone="lilac">Evento: {event.name}</Badge>}
              <Badge tone="green">Solo con permiso</Badge>
            </div>
            <p className="mt-4 text-3xl font-extrabold">{recipients.length}</p>
            <p className="text-xs text-muted">destinatarios con permiso vigente{c.status === "sent" ? " (hoy)" : ""}</p>
            {c.status !== "sent" && (
              <div className="mt-4 flex flex-wrap items-start gap-2">
                <ActionForm action={sendCampaignNow} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Submit>Enviar ahora a {recipients.length}</Submit>
                </ActionForm>
                {c.status === "draft" && (
                  <form action={deleteDraftCampaign}><input type="hidden" name="id" value={c.id} /><button className={btn("danger")}>Eliminar borrador</button></form>
                )}
              </div>
            )}
            {c.scheduledAt && c.status === "scheduled" && <p className="mt-2 text-xs text-muted">Programada para {fmtDateTime(c.scheduledAt)}</p>}
          </Card>

          {sent > 0 && (
            <Card className="p-5">
              <p className="label">Resultados · enviada {fmtDate(c.sentAt, { dateStyle: "medium" })}</p>
              <div className="mt-3 flex flex-col gap-3">
                {[
                  ["Entregados", n("delivered", "opened", "clicked"), sent],
                  ["Abiertos", n("opened", "clicked"), sent],
                  ["Clics", n("clicked"), sent],
                  ["Rebotes y spam", n("bounced", "complained"), sent],
                ].map(([l, v, d]) => (
                  <div key={l as string} className="flex items-center gap-3">
                    <span className="w-28 text-sm">{l}</span>
                    <Progress value={v as number} max={d as number} tone={l === "Rebotes y spam" ? "red" : "green"} />
                    <span className="w-20 text-right text-xs font-semibold text-muted">{v} · {pct(v as number, d as number)}%</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <PanelHeader title={sends.length ? "Últimos envíos" : "Primeros destinatarios"} />
            <div className="mt-2">
              {(sends.length ? sends.map((s) => ({ k: s.id, email: s.email, right: SEND_STATUS[s.status] })) : recipients.slice(0, 12).map((r) => ({ k: r.id, email: `${r.name} · ${r.email}`, right: r.city ? CITY[r.city] : "" }))).map((x) => (
                <div key={x.k} className="flex items-center justify-between border-b border-[#EFEDE6] px-5 py-2 text-sm last:border-b-0">
                  <span className="truncate">{x.email}</span><span className="text-xs text-muted">{x.right}</span>
                </div>
              ))}
              {recipients.length === 0 && sends.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Nadie con permiso en este segmento.</p>}
            </div>
          </Card>
        </div>
        <Card className="overflow-hidden">
          <div className="border-b border-line p-4">
            <p className="text-[11px] text-faint">Asunto</p>
            <p className="font-bold">{renderTemplate(c.subject ?? t.subject, vars)}</p>
            <p className="mt-1 text-xs text-muted">Vista previa como la recibiría {sample?.name ?? "un contacto"}. <Link href={`/templates/${t.id}`} className="text-emerald underline">Editar plantilla</Link></p>
          </div>
          <iframe title="preview" sandbox="" srcDoc={renderTemplate(t.html, vars)} className="h-[680px] w-full border-0 bg-white" />
        </Card>
      </div>
    </div>
  );
}
