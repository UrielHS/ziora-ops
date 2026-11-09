import Link from "next/link";
import { and, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { CircleAlert, Inbox, ListChecks, Smartphone } from "lucide-react";
import { addTicketInfo, createTicket, evaluateTicket } from "@/actions/tickets";
import { Avatar, Badge, Card, cn, Empty, Field, inputCls, Kpi, PageHeader, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { bugs, tasks, tickets } from "@/db/schema";
import { priorityScore, userStoryText } from "@/domain/tickets";
import { fmtDate, relative } from "@/lib/format";
import { EFFORT, TICKET_KIND, TICKET_ORIGIN, TICKET_STATUS, VIABILITY } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requireAccess } from "@/lib/session";
import { DeleteButton } from "@/components/ui/delete-button";

export const dynamic = "force-dynamic";

type Ticket = typeof tickets.$inferSelect;
const AREAS = ["Agenda", "Notas clínicas", "Grabación y transcripción", "Copilot", "Portal del paciente", "Escalas", "Pagos y planes", "Reportes", "Clínicas (multiusuario)", "Onboarding", "Otro"];
const VIEWS = {
  evaluar: { label: "Por evaluar", statuses: ["new", "evaluating"] },
  planeados: { label: "Planeados", statuses: ["planned", "in_progress"] },
  cerrados: { label: "Cerrados", statuses: ["done", "rejected"] },
  todos: { label: "Todos", statuses: null },
} as const;

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ ver?: string; origen?: string; mios?: string; nuevo?: string; id?: string }> }) {
  const sp = await searchParams;
  const access = await requireAccess();
  const canTriage = can(access, "tickets.triage");
  const view = (sp.ver && sp.ver in VIEWS ? sp.ver : "evaluar") as keyof typeof VIEWS;
  const where: SQL[] = [];
  const statuses = VIEWS[view].statuses;
  if (statuses) where.push(inArray(tickets.status, [...statuses]));
  if (sp.origen === "app") where.push(eq(tickets.origin, "ziora_app_help"));
  if (sp.mios === "1") where.push(eq(tickets.reporterId, access.user.id));

  const since = new Date(Date.now() - 30 * 86400000);
  const [users, rows, all, linkedTasks, openBugs] = await Promise.all([
    listUsers(),
    db.select().from(tickets).where(where.length ? and(...where) : undefined).orderBy(desc(tickets.createdAt)).limit(200),
    db.select({ status: tickets.status, viability: tickets.viability, origin: tickets.origin, createdAt: tickets.createdAt }).from(tickets),
    db.select({ id: tasks.id, number: tasks.number, status: tasks.status }).from(tasks).where(inArray(tasks.id, db.select({ id: tickets.taskId }).from(tickets))),
    db.select({ id: bugs.id, number: bugs.number, title: bugs.title }).from(bugs).where(inArray(bugs.status, ["new", "triaged", "in_progress"])),
  ]);
  // Por evaluar: los de mayor puntaje arriba; lo nuevo sin puntaje, por fecha.
  const sorted = view === "evaluar" || view === "planeados"
    ? [...rows].sort((a, b) => priorityScore(b.impact, b.effort) - priorityScore(a.impact, a.effort))
    : rows;
  const name = (id: string | null) => users.find((u) => u.id === id)?.name;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ver: view, origen: sp.origen, mios: sp.mios, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/tickets?${p}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Producto"
        title="Tickets"
        subtitle="Cambios, ideas y errores del equipo y de los usuarios de Ziora, escritos como historia de usuario."
        actions={can(access, "tickets.create") && <NewTicket defaultOpen={sp.nuevo === "1"} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Por evaluar" value={all.filter((t) => t.status === "new").length} icon={Inbox} href={qs({ ver: "evaluar" })} highlight={all.some((t) => t.status === "new")} />
        <Kpi label="Falta información" value={all.filter((t) => t.viability === "needs_info" && !["done", "rejected"].includes(t.status)).length} icon={CircleAlert} />
        <Kpi label="Planeados y en curso" value={all.filter((t) => ["planned", "in_progress"].includes(t.status)).length} icon={ListChecks} href={qs({ ver: "planeados" })} />
        <Kpi label="Desde la app (30 días)" value={all.filter((t) => t.origin === "ziora_app_help" && t.createdAt >= since).length} icon={Smartphone} href={qs({ origen: "app" })} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(VIEWS).map(([k, v]) => (
          <Link key={k} href={qs({ ver: k })} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", view === k ? "bg-mint text-emerald" : "border border-line bg-white text-muted")}>{v.label}</Link>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <Link href={qs({ origen: sp.origen === "app" ? undefined : "app" })} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", sp.origen === "app" ? "bg-mint text-emerald" : "border border-line bg-white text-muted")}>Solo de la app</Link>
        <Link href={qs({ mios: sp.mios === "1" ? undefined : "1" })} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", sp.mios === "1" ? "bg-mint text-emerald" : "border border-line bg-white text-muted")}>Los que yo levanté</Link>
      </div>

      <Card>
        {sorted.length === 0 && <div className="p-5"><Empty title="Nada por aquí" text="Cuando alguien levante un ticket o llegue un mensaje de la app aparecerá en esta lista." /></div>}
        {sorted.map((t) => {
          const task = linkedTasks.find((x) => x.id === t.taskId);
          const score = priorityScore(t.impact, t.effort);
          const reporter = name(t.reporterId) ?? t.reporterEmail ?? "—";
          return (
            <div key={t.id} className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0">
              <Badge tone={TICKET_KIND[t.kind].tone} className="hidden w-28 justify-center sm:inline-flex">{TICKET_KIND[t.kind].label}</Badge>
              <Modal
                title={`TKT-${t.number}`}
                wide
                defaultOpen={sp.id === t.id}
                triggerClass="min-w-0 flex-1 text-left"
                trigger={
                  <span className="block min-w-0">
                    <span className="block truncate text-sm font-semibold hover:text-emerald"><span className="mr-2 text-xs text-faint">TKT-{t.number}</span>{t.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {t.origin === "ziora_app_help" && <Smartphone className="mr-1 inline h-3 w-3" />}
                      {reporter} · {relative(t.createdAt)}{t.area ? ` · ${t.area}` : ""}{task ? ` · ZOP-${task.number}` : ""}
                    </span>
                  </span>
                }
              >
                <TicketDetail t={t} reporter={reporter} canTriage={canTriage} isReporter={t.reporterId === access.user.id} users={users} openBugs={openBugs} taskNumber={task?.number} />
              </Modal>
              {score > 0 && <span title="Impacto ÷ esfuerzo" className="hidden text-xs font-bold text-muted md:block">{score}</span>}
              <Badge tone={VIABILITY[t.viability].tone} className="hidden md:inline-flex">{VIABILITY[t.viability].label}</Badge>
              <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function TicketDetail({
  t, reporter, canTriage, isReporter, users, openBugs, taskNumber,
}: {
  t: Ticket; reporter: string; canTriage: boolean; isReporter: boolean;
  users: { id: string; name: string }[]; openBugs: { id: string; number: number; title: string }[]; taskNumber?: number;
}) {
  return (
    <div className={cn("grid gap-5", canTriage && "md:grid-cols-[1.1fr_1fr]")}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={TICKET_KIND[t.kind].tone}>{TICKET_KIND[t.kind].label}</Badge>
          <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
          <Badge tone={VIABILITY[t.viability].tone}>{VIABILITY[t.viability].label}</Badge>
          {taskNumber && <Badge tone="gray">Tarea ZOP-{taskNumber}</Badge>}
        </div>
        <p className="text-base font-bold">{t.title}</p>
        {t.iWant ? (
          <p className="whitespace-pre-wrap rounded-2xl bg-[#F7F6F0] p-4 leading-relaxed">{userStoryText(t)}</p>
        ) : (
          <p className="rounded-2xl bg-warn-bg px-4 py-3 text-xs text-warn">Todavía no está escrito como historia de usuario. Dev/QA lo traduce al evaluarlo.</p>
        )}
        {t.context && <div><p className="label">Contexto</p><p className="mt-1 whitespace-pre-wrap text-muted">{t.context}</p></div>}
        {t.decisionNote && <div className="rounded-xl bg-mint px-3 py-2 text-xs text-emerald"><b>Dev/QA:</b> {t.decisionNote}</div>}
        <p className="flex items-center gap-2 text-xs text-muted">
          <Avatar name={reporter} size={20} /> {TICKET_ORIGIN[t.origin]} · {reporter} · {fmtDate(t.createdAt, { dateStyle: "medium" })}
          {t.appVersion ? ` · v${t.appVersion}` : ""}{t.category ? ` · ${t.category}` : ""}
        </p>
        {(isReporter || canTriage) && !["done", "rejected"].includes(t.status) && (
          <ActionForm action={addTicketInfo} resetOnSuccess className="flex flex-col gap-2 border-t border-line pt-3">
            <input type="hidden" name="id" value={t.id} />
            <Field label={t.viability === "needs_info" ? "Dev/QA pidió más información" : "Agregar información"}>
              <textarea name="info" rows={2} required className={inputCls} placeholder="Ej. Pasa solo con clínicas de más de 5 terapeutas." />
            </Field>
            <Submit variant="secondary">Agregar</Submit>
          </ActionForm>
        )}
      </div>

      {canTriage && (
        <>
        <ActionForm action={evaluateTicket}>
          <input type="hidden" name="id" value={t.id} />
          <p className="label">Evaluación de Dev/QA</p>
          <Field label="Título"><input name="title" required defaultValue={t.title} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo"><Select name="kind" defaultValue={t.kind} options={Object.entries(TICKET_KIND).map(([k, v]) => [k, v.label])} /></Field>
            <Field label="Área"><Select name="area" defaultValue={t.area} placeholder="—" options={AREAS.map((a) => [a, a])} /></Field>
          </div>
          <Field label="Como…"><input name="asA" defaultValue={t.asA ?? ""} className={inputCls} placeholder="terapeuta que atiende por videollamada" /></Field>
          <Field label="quiero…"><textarea name="iWant" rows={2} defaultValue={t.iWant ?? ""} className={inputCls} /></Field>
          <Field label="para…"><textarea name="soThat" rows={2} defaultValue={t.soThat ?? ""} className={inputCls} /></Field>
          <Field label="Sabremos que está listo cuando…" hint="Un criterio por línea."><textarea name="criteria" rows={3} defaultValue={t.acceptanceCriteria.join("\n")} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Impacto (1–5)"><Select name="impact" defaultValue={t.impact ? String(t.impact) : ""} placeholder="—" options={[["1", "1 · mínimo"], ["2", "2"], ["3", "3 · medio"], ["4", "4"], ["5", "5 · crítico"]]} /></Field>
            <Field label="Esfuerzo"><Select name="effort" defaultValue={t.effort} placeholder="—" options={Object.entries(EFFORT)} /></Field>
            <Field label="Viabilidad"><Select name="viability" defaultValue={t.viability} options={Object.entries(VIABILITY).map(([k, v]) => [k, v.label])} /></Field>
            <Field label="Estado"><Select name="status" defaultValue={t.status} options={Object.entries(TICKET_STATUS).map(([k, v]) => [k, v.label])} /></Field>
            <Field label="Responsable"><Select name="assigneeId" defaultValue={t.assigneeId} placeholder="Sin asignar" options={users.map((u) => [u.id, u.name])} /></Field>
            <Field label="Bug relacionado"><Select name="bugId" defaultValue={t.bugId} placeholder="—" options={openBugs.map((b) => [b.id, `BUG-${b.number} · ${b.title.slice(0, 40)}`])} /></Field>
          </div>
          <Field label="Nota para quien lo pidió" hint="Obligatoria si no se hará. Se le envía por correo."><textarea name="decisionNote" rows={2} defaultValue={t.decisionNote ?? ""} className={inputCls} /></Field>
          <Submit>Guardar evaluación</Submit>
          <p className="text-[11px] text-faint">Al pasar a &quot;Planeado&quot; se crea la tarea en el tablero con la historia y los criterios.</p>
        </ActionForm>
          <div className="border-t border-line pt-3">
            <DeleteButton kind="ticket" id={t.id} what={`TKT-${t.number}`} warning="Si ya se convirtió en tarea, la tarea se queda." label="Eliminar ticket" />
          </div>
        </>
      )}
    </div>
  );
}

function NewTicket({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <Modal trigger="+ Nuevo ticket" title="Nuevo ticket" wide defaultOpen={defaultOpen}>
      <ActionForm action={createTicket}>
        <div className="rounded-2xl border border-line bg-white p-4 text-xs text-muted">
          <p className="mb-1 font-bold text-ink">Escríbelo como una historia corta</p>
          <p><b>Como</b> director de una clínica, <b>quiero</b> ver qué terapeutas tienen notas pendientes, <b>para</b> darles seguimiento antes del cierre de mes.</p>
          <p className="mt-1"><b>Sabremos que está listo cuando:</b> veo un contador de notas pendientes por terapeuta.</p>
        </div>
        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <Field label="¿Qué es?"><Select name="kind" defaultValue="change" options={Object.entries(TICKET_KIND).map(([k, v]) => [k, v.label])} /></Field>
          <Field label="Título corto"><input name="title" required className={inputCls} placeholder="Notas pendientes por terapeuta" /></Field>
        </div>
        <Field label="Como… (¿quién lo necesita?)">
          <input name="asA" list="ticket-roles" className={inputCls} placeholder="terapeuta, director de clínica, alguien del equipo…" />
          <datalist id="ticket-roles">
            {["terapeuta que usa Ziora", "director de una clínica", "paciente de un terapeuta", "alguien del equipo de ventas", "director clínico de Ziora"].map((r) => <option key={r} value={r} />)}
          </datalist>
        </Field>
        <Field label="quiero… (¿qué necesita poder hacer?)"><textarea name="iWant" rows={2} required className={inputCls} /></Field>
        <Field label="para… (¿para qué le sirve?)"><textarea name="soThat" rows={2} className={inputCls} /></Field>
        <Field label="Sabremos que está listo cuando…" hint="Opcional. Una idea por línea."><textarea name="criteria" rows={2} className={inputCls} /></Field>
        <Field label="Área (opcional)"><Select name="area" placeholder="No sé" options={AREAS.map((a) => [a, a])} /></Field>
        <Field label="Contexto (opcional)" hint="Quién lo pidió, cuántas veces ha salido, capturas sin datos de pacientes…"><textarea name="context" rows={2} className={inputCls} /></Field>
        <p className="rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn">Sin nombres, notas ni datos de pacientes.</p>
        <Submit>Levantar ticket</Submit>
      </ActionForm>
    </Modal>
  );
}
