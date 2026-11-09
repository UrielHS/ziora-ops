import { CalendarDays, Flag, OctagonAlert } from "lucide-react";
import { createTask, updateTask } from "@/actions/tasks";
import { Avatar, Badge, btn, Field, inputCls, Select, cn } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import type { epics, sprints, tasks } from "@/db/schema";
import type { UserOption } from "@/db/queries";
import { fmtDate, todayISO } from "@/lib/format";
import { PRIORITY, TASK_STATUS } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";

type Task = typeof tasks.$inferSelect;
type Epic = typeof epics.$inferSelect;
type Sprint = typeof sprints.$inferSelect;
export type TaskOpts = { users: UserOption[]; epics: Epic[]; sprints: Sprint[] };

function TaskFields({ t, opts, defaultSprint }: { t?: Task; opts: TaskOpts; defaultSprint?: string | null }) {
  return (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <Field label="Título">
        <input name="title" required defaultValue={t?.title} className={inputCls} placeholder="Ej. Banco de 30 piezas para IG" />
      </Field>
      <Field label="Descripción">
        <textarea name="description" rows={3} defaultValue={t?.description ?? ""} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Estado">
          <Select name="status" defaultValue={t?.status ?? "todo"} options={Object.entries(TASK_STATUS).map(([k, v]) => [k, v.label])} />
        </Field>
        <Field label="Prioridad">
          <Select name="priority" defaultValue={t?.priority ?? "medium"} options={Object.entries(PRIORITY).map(([k, v]) => [k, v.label])} />
        </Field>
        <Field label="Épica">
          <Select name="epicId" defaultValue={t?.epicId} placeholder="Sin épica" options={opts.epics.map((e) => [e.id, `${e.key} · ${e.name}`])} />
        </Field>
        <Field label="Sprint">
          <Select name="sprintId" defaultValue={t ? t.sprintId : defaultSprint} placeholder="Backlog (sin sprint)" options={opts.sprints.filter((s) => s.status !== "closed" || s.id === t?.sprintId).map((s) => [s.id, s.name])} />
        </Field>
        <Field label="Responsable">
          <Select name="assigneeId" defaultValue={t?.assigneeId} placeholder="Sin asignar" options={opts.users.map((u) => [u.id, u.name])} />
        </Field>
        <Field label="Fecha límite">
          <input type="date" name="dueOn" defaultValue={t?.dueOn ?? ""} className={inputCls} />
        </Field>
      </div>
      <Field label="Etiquetas" hint="Separadas por coma">
        <input name="labels" defaultValue={t?.labels.join(", ")} className={inputCls} placeholder="gtm, video" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="blocker" defaultChecked={t?.blocker} className="h-4 w-4 accent-[#B42318]" />
        Es un bloqueo (aparece arriba en el Dashboard)
      </label>
    </>
  );
}

export function NewTaskButton({ opts, defaultSprint, defaultOpen }: { opts: TaskOpts; defaultSprint?: string | null; defaultOpen?: boolean }) {
  return (
    <Modal trigger="+ Nueva tarea" title="Nueva tarea" defaultOpen={defaultOpen}>
      <ActionForm action={createTask}>
        <TaskFields opts={opts} defaultSprint={defaultSprint} />
        <Submit>Crear tarea</Submit>
      </ActionForm>
    </Modal>
  );
}

export function TaskCard({ t, opts, compact }: { t: Task; opts: TaskOpts; compact?: boolean }) {
  const epic = opts.epics.find((e) => e.id === t.epicId);
  const assignee = opts.users.find((u) => u.id === t.assigneeId);
  const overdue = t.dueOn && t.status !== "done" && t.dueOn < todayISO();
  return (
    <Modal
      title={`ZOP-${t.number}`}
      triggerClass={cn(
        "w-full rounded-2xl border bg-white p-3 text-left transition-colors hover:border-emerald/40",
        t.blocker ? "border-danger/40" : "border-line",
      )}
      trigger={
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-faint">ZOP-{t.number}</span>
            {t.blocker && <OctagonAlert className="h-3.5 w-3.5 text-danger" />}
            {epic && (
              <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: epic.color }}>{epic.key}</span>
            )}
          </div>
          <p className={cn("text-[13.5px] font-semibold leading-snug", t.status === "done" && "text-faint line-through")}>{t.title}</p>
          {!compact && (
            <div className="flex items-center gap-2">
              <Badge tone={PRIORITY[t.priority].tone}>
                <Flag className="mr-1 h-3 w-3" />
                {PRIORITY[t.priority].label}
              </Badge>
              {t.dueOn && (
                <span className={cn("flex items-center gap-1 text-[11px]", overdue ? "font-semibold text-danger" : "text-faint")}>
                  <CalendarDays className="h-3 w-3" /> {fmtDate(t.dueOn)}
                </span>
              )}
              <span className="ml-auto"><Avatar name={assignee?.name} size={22} /></span>
            </div>
          )}
        </div>
      }
    >
      <ActionForm action={updateTask}>
        <TaskFields t={t} opts={opts} />
        <div className="flex items-center justify-between">
          <Submit>Guardar</Submit>
        </div>
      </ActionForm>
      <div className="mt-3 border-t border-line pt-3">
        <DeleteButton kind="task" id={t.id} what={`la tarea "${t.title}"`} label="Eliminar tarea" />
      </div>
    </Modal>
  );
}

export function TaskRow({ t, opts }: { t: Task; opts: TaskOpts }) {
  const epic = opts.epics.find((e) => e.id === t.epicId);
  const assignee = opts.users.find((u) => u.id === t.assigneeId);
  return (
    <div className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-2.5 last:border-b-0">
      <span className="w-16 shrink-0 text-xs font-semibold text-faint">ZOP-{t.number}</span>
      <p className={cn("min-w-0 flex-1 truncate text-sm font-medium", t.status === "done" && "text-faint line-through")}>
        {t.blocker && <OctagonAlert className="mr-1 inline h-3.5 w-3.5 text-danger" />}
        {t.title}
      </p>
      {epic && <span className="hidden rounded-full px-2 py-0.5 text-[10px] font-bold text-white sm:inline" style={{ background: epic.color }}>{epic.key}</span>}
      <Badge tone={PRIORITY[t.priority].tone} className="hidden sm:inline-flex">{PRIORITY[t.priority].label}</Badge>
      <Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
      <Avatar name={assignee?.name} size={24} />
    </div>
  );
}
