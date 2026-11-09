import { desc, eq } from "drizzle-orm";
import { moveDemo, syncDemosNow } from "@/actions/demos";
import { ActionForm, Submit } from "@/components/ui/form";
import { DemoCard, NewDemoButton } from "@/components/demos";
import { Card, PageHeader } from "@/components/ui";
import { Kanban } from "@/components/ui/kanban";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { demoRequests, contacts } from "@/db/schema";
import { pct } from "@/lib/format";
import { DEMO_STAGE } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const COLUMNS = ["requested", "scheduled", "done", "trial", "paid", "lost"] as const;
const ACCENT: Record<string, string> = { requested: "bg-faint", scheduled: "bg-[#1D5FA8]", done: "bg-[#6B4FA8]", trial: "bg-[#D99A2B]", paid: "bg-emerald", lost: "bg-danger" };

export default async function DemosPage({ searchParams }: { searchParams: Promise<{ nuevo?: string }> }) {
  await requirePagePermission("leads.view");
  const sp = await searchParams;
  const [users, rows] = await Promise.all([
    listUsers(),
    db.select({ demo: demoRequests, city: contacts.city }).from(demoRequests).leftJoin(contacts, eq(contacts.id, demoRequests.contactId)).orderBy(desc(demoRequests.createdAt)),
  ]);
  const demos = rows.map((r) => ({ ...r.demo, city: r.city }));
  const by = (s: string[]) => demos.filter((d) => s.includes(d.stage)).length;
  const total = demos.length;
  const reached = by(["done", "trial", "paid"]);
  const trial = by(["trial", "paid"]);
  const paid = by(["paid"]);

  const funnel = [
    { label: "Solicitudes", value: total, note: "Todas" },
    { label: "Demo realizada", value: reached, note: `${pct(reached, total)}% de solicitudes` },
    { label: "Iniciaron trial", value: trial, note: `${pct(trial, reached)}% de realizadas` },
    { label: "Pagaron", value: paid, note: `${pct(paid, trial)}% de trials` },
    { label: "No asistió / perdida", value: by(["no_show", "lost"]), note: "Revisar motivos" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas"
        title="Pipeline de demos"
        subtitle="Las demos de ziora-copilot.com entran solas, con sus UTM; el calendario del CEO queda de respaldo. Arrastra las tarjetas para cambiar de etapa."
        actions={
          <>
            <ActionForm action={syncDemosNow} className="flex flex-col items-end gap-1">
              <Submit variant="ghost">Leer calendario ahora</Submit>
            </ActionForm>
            <NewDemoButton users={users} defaultOpen={sp.nuevo === "1"} />
          </>
        }
      />
      <Card className="grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x">
        {funnel.map((f) => (
          <div key={f.label} className="p-4">
            <p className="label">{f.label}</p>
            <p className="mt-1 text-2xl font-extrabold">{f.value}</p>
            <p className="text-[11px] text-muted">{f.note}</p>
          </div>
        ))}
      </Card>
      <Kanban
        columns={COLUMNS.map((c) => ({ id: c, label: c === "lost" ? "Perdida / no asistió" : DEMO_STAGE[c].label, accent: ACCENT[c] }))}
        items={demos.map((d) => ({ id: d.id, column: d.stage === "no_show" ? "lost" : d.stage, node: <DemoCard d={d} users={users} /> }))}
        onMove={moveDemo}
        minColWidth={200}
      />
    </div>
  );
}
