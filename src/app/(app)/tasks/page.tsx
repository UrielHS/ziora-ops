import Link from "next/link";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { activateSprint, createSprint, moveTask } from "@/actions/tasks";
import { NewTaskButton, TaskCard, TaskRow, type TaskOpts } from "@/components/tasks";
import { Badge, btn, Card, cn, Field, inputCls, PageHeader, PanelHeader, Progress, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { Kanban } from "@/components/ui/kanban";
import { db } from "@/db";
import { listEpics, listSprints, listUsers } from "@/db/queries";
import { tasks } from "@/db/schema";
import { fmtDate } from "@/lib/format";
import { TASK_STATUS } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";

export const dynamic = "force-dynamic";

type SP = { sprint?: string; epic?: string; assignee?: string; view?: string; nuevo?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [users, epics, sprints] = await Promise.all([listUsers(), listEpics(), listSprints()]);
  const opts: TaskOpts = { users, epics, sprints };
  const active = sprints.find((s) => s.status === "active");
  const sprintFilter = sp.sprint ?? active?.id ?? "all";

  const where: SQL[] = [];
  if (sprintFilter === "backlog") where.push(isNull(tasks.sprintId));
  else if (sprintFilter !== "all") where.push(eq(tasks.sprintId, sprintFilter));
  if (sp.epic) where.push(eq(tasks.epicId, sp.epic));
  if (sp.assignee) where.push(eq(tasks.assigneeId, sp.assignee));
  const rows = await db.select().from(tasks).where(where.length ? and(...where) : undefined).orderBy(asc(tasks.position), asc(tasks.number));

  const allTasks = await db.select({ sprintId: tasks.sprintId, status: tasks.status }).from(tasks);
  const view = sp.view === "list" ? "list" : "board";
  const columns = (sprintFilter === "backlog" ? ["backlog", "todo"] : ["todo", "in_progress", "in_review", "done"]) as (keyof typeof TASK_STATUS)[];
  const accents: Record<string, string> = { backlog: "bg-faint", todo: "bg-faint", in_progress: "bg-[#1D5FA8]", in_review: "bg-[#D99A2B]", done: "bg-emerald" };
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch, nuevo: undefined }).filter(([, v]) => v) as [string, string][]);
    return `/tasks?${p}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Operación"
        title="Tareas"
        subtitle={active ? `${active.name} · ${fmtDate(active.startsOn)} – ${fmtDate(active.endsOn)}${active.goal ? ` · ${active.goal}` : ""}` : "Sin sprint activo"}
        actions={
          <>
            <div className="flex rounded-full border border-line bg-white p-0.5 text-xs font-semibold">
              <Link href={qs({ view: "board" })} className={cn("rounded-full px-3 py-1.5", view === "board" ? "bg-mint text-emerald" : "text-muted")}>Tablero</Link>
              <Link href={qs({ view: "list" })} className={cn("rounded-full px-3 py-1.5", view === "list" ? "bg-mint text-emerald" : "text-muted")}>Lista</Link>
            </div>
            <NewTaskButton opts={opts} defaultSprint={sprintFilter !== "all" && sprintFilter !== "backlog" ? sprintFilter : null} defaultOpen={sp.nuevo === "1"} />
          </>
        }
      />

      <form className="flex flex-wrap items-end gap-2">
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        <Select name="sprint" defaultValue={sprintFilter} className="w-auto rounded-full py-1.5 text-xs"
          options={[["all", "Todos los sprints"], ["backlog", "Backlog"], ...sprints.map((s) => [s.id, s.name + (s.status === "active" ? " (activo)" : "")] as [string, string])]} />
        <Select name="epic" defaultValue={sp.epic} placeholder="Todas las épicas" className="w-auto rounded-full py-1.5 text-xs" options={epics.map((e) => [e.id, e.name])} />
        <Select name="assignee" defaultValue={sp.assignee} placeholder="Todo el equipo" className="w-auto rounded-full py-1.5 text-xs" options={users.map((u) => [u.id, u.name])} />
        <button className={btn("ghost", "sm")}>Filtrar</button>
      </form>

      {view === "board" ? (
        <Kanban
          columns={columns.map((c) => ({ id: c, label: TASK_STATUS[c].label, accent: accents[c] }))}
          items={rows.filter((t) => columns.includes(t.status)).map((t) => ({ id: t.id, column: t.status, node: <TaskCard t={t} opts={opts} /> }))}
          onMove={moveTask}
          minColWidth={250}
        />
      ) : (
        <Card>
          {rows.length === 0 && <p className="p-6 text-sm text-muted">No hay tareas con estos filtros.</p>}
          {rows.map((t) => <TaskRow key={t.id} t={t} opts={opts} />)}
        </Card>
      )}

      <Card>
        <PanelHeader
          title="Sprints"
          subtitle="Ciclos de 2 semanas alineados al plan GTM de 90 días"
          action={
            <Modal trigger="+ Sprint" title="Nuevo sprint" triggerClass={btn("ghost", "sm")}>
              <ActionForm action={createSprint}>
                <Field label="Nombre"><input name="name" required className={inputCls} placeholder="Semana 3–4 · Educación y memes" /></Field>
                <Field label="Objetivo"><input name="goal" className={inputCls} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Inicio"><input type="date" name="startsOn" required className={inputCls} /></Field>
                  <Field label="Fin"><input type="date" name="endsOn" required className={inputCls} /></Field>
                </div>
                <Submit>Crear sprint</Submit>
              </ActionForm>
            </Modal>
          }
        />
        <div className="mt-3 grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {sprints.map((s) => {
            const st = allTasks.filter((t) => t.sprintId === s.id);
            const done = st.filter((t) => t.status === "done").length;
            return (
              <div key={s.id} className={cn("rounded-2xl border p-4", s.status === "active" ? "border-emerald/40 bg-mint/50" : "border-line")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">{s.name}</p>
                  <Badge tone={s.status === "active" ? "green" : s.status === "closed" ? "gray" : "blue"}>
                    {s.status === "active" ? "Activo" : s.status === "closed" ? "Cerrado" : "Planeado"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">{fmtDate(s.startsOn)} – {fmtDate(s.endsOn)}</p>
                <div className="mt-3 flex items-center gap-2">
                  <Progress value={done} max={st.length} />
                  <span className="whitespace-nowrap text-[11px] font-semibold text-muted">{done}/{st.length}</span>
                </div>
                <DeleteButton kind="sprint" id={s.id} what={`el sprint ${s.name}`} warning="Sus tareas regresan al backlog." className="mt-2" label="Eliminar sprint" />
                {s.status !== "active" && (
                  <form action={activateSprint} className="mt-3">
                    <input type="hidden" name="id" value={s.id} />
                    <button className={btn("ghost", "sm")}>Activar</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
