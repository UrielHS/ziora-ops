import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { Badge, btn, Card, Empty, PageHeader, PanelHeader } from "@/components/ui";
import { db } from "@/db";
import { emailTemplates, sequenceEnrollments, sequences, sequenceSteps } from "@/db/schema";
import { fmtDate } from "@/lib/format";
import { SEQUENCE_CHANNEL } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Lista de secuencias: pasos, enrolados por estado y correos enviados. Solo lectura; la semilla vive en dev/seed-secuencia-mtw.ts. */
export default async function SequencesPage() {
  await requirePagePermission("leads.view");

  const [seqs, steps, counts, sent] = await Promise.all([
    db.select().from(sequences).orderBy(sequences.name),
    db.select({ id: sequenceSteps.id, sequenceId: sequenceSteps.sequenceId, position: sequenceSteps.position, dayOffset: sequenceSteps.dayOffset, channel: sequenceSteps.channel, templateName: emailTemplates.name })
      .from(sequenceSteps).leftJoin(emailTemplates, eq(emailTemplates.id, sequenceSteps.emailTemplateId)).orderBy(sequenceSteps.sequenceId, sequenceSteps.position),
    db.select({ sequenceId: sequenceEnrollments.sequenceId, status: sequenceEnrollments.status, n: sql<number>`count(*)::int` })
      .from(sequenceEnrollments).groupBy(sequenceEnrollments.sequenceId, sequenceEnrollments.status),
    // Correos que mandó el job: actividades de correo con meta.sequenceId.
    db.execute<{ sequence_id: string; n: number }>(sql`select meta->>'sequenceId' as sequence_id, count(*)::int as n from ops.contact_activities where type = 'correo' and meta ? 'sequenceId' group by 1`),
  ]);
  const sentBy = new Map(sent.map((r) => [r.sequence_id, Number(r.n)]));
  const countBy = (id: string, status: string) => counts.find((c) => c.sequenceId === id && c.status === status)?.n ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas"
        title="Secuencias"
        subtitle="Cadencias de seguimiento: correos automáticos y WhatsApp que aparecen listos en Mi día. Se detienen solas cuando el lead responde, se pierde o se da de baja."
        actions={
          <>
            <Link href="/leads/hoy" className={btn("ghost", "sm")}>Mi día</Link>
            <Link href="/leads" className={btn("secondary", "sm")}>Kanban</Link>
          </>
        }
      />

      {seqs.length === 0 && <Empty title="Todavía no hay secuencias" text="Se crean con la semilla (docs/RUNBOOK-CRM-LEADS.md §7). Cuando exista una, podrás enrolar leads desde el kanban, la ficha o la importación." />}

      {seqs.map((s) => {
        const mySteps = steps.filter((st) => st.sequenceId === s.id);
        return (
          <Card key={s.id}>
            <PanelHeader
              title={s.name}
              subtitle={`${mySteps.length} pasos · máximo ${s.maxTouches} toques · ${s.stopOnReply ? "se detiene al responder" : "no se detiene al responder"} · creada ${fmtDate(s.createdAt)}`}
              action={<Badge tone={s.active ? "green" : "gray"}>{s.active ? "Activa" : "Inactiva"}</Badge>}
            />
            <div className="grid gap-4 px-5 pb-5 md:grid-cols-[1fr_auto]">
              <ol className="flex flex-col gap-1.5 text-sm">
                {mySteps.map((st) => (
                  <li key={st.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-14 text-xs font-semibold text-muted">Día {st.dayOffset}</span>
                    <Badge tone={st.channel === "email" ? "blue" : "green"}>{SEQUENCE_CHANNEL[st.channel]}</Badge>
                    <span className="text-muted">{st.channel === "email" ? st.templateName ?? "(plantilla borrada)" : "texto listo para copiar en Mi día"}</span>
                  </li>
                ))}
              </ol>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                {([["Activos", countBy(s.id, "activa")], ["Terminados", countBy(s.id, "terminada")], ["Detenidos", countBy(s.id, "detenida")], ["Correos enviados", sentBy.get(s.id) ?? 0]] as const).map(([l, v]) => (
                  <div key={l}>
                    <dt className="label">{l}</dt>
                    <dd className="text-xl font-extrabold">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
