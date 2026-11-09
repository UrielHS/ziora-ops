import { cancelFollowup, completeFollowup, createFollowup } from "@/actions/followups";
import { Badge, btn, cn, Field, inputCls, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import type { followups } from "@/db/schema";
import { fmtDate, relative, todayISO } from "@/lib/format";
import { FOLLOWUP_CHANNEL, FOLLOWUP_REASON, HEALTH } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";

type Followup = typeof followups.$inferSelect;
type Opt = { id: string; name: string };

export function NewFollowupButton({
  users, accounts, appUserUid, appUserLabel, accountId, trigger = "+ Seguimiento", triggerClass, defaultOpen,
}: {
  users: Opt[]; accounts?: Opt[]; appUserUid?: string; appUserLabel?: string; accountId?: string;
  trigger?: React.ReactNode; triggerClass?: string; defaultOpen?: boolean;
}) {
  const fixed = appUserUid || accountId;
  return (
    <Modal trigger={trigger} title={appUserLabel ? `Seguimiento a ${appUserLabel}` : "Agendar seguimiento"} triggerClass={triggerClass} defaultOpen={defaultOpen}>
      <ActionForm action={createFollowup}>
        {appUserUid && <input type="hidden" name="appUserUid" value={appUserUid} />}
        {accountId && <input type="hidden" name="accountId" value={accountId} />}
        {!fixed && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Terapeuta (correo en Ziora)"><input name="appUserEmail" type="email" className={inputCls} placeholder="psic@ejemplo.com" /></Field>
            <Field label="o cuenta B2B"><Select name="accountId" placeholder="—" options={(accounts ?? []).map((a) => [a.id, a.name])} /></Field>
          </div>
        )}
        <Field label="¿Qué hay que hacer?"><input name="title" required className={inputCls} placeholder="Llamada para revisar cómo va con las notas" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Canal"><Select name="channel" defaultValue="call" options={Object.entries(FOLLOWUP_CHANNEL)} /></Field>
          <Field label="Fecha"><input name="dueOn" type="date" required defaultValue={todayISO()} className={inputCls} /></Field>
          <Field label="Responsable"><Select name="ownerId" placeholder="Yo" options={users.map((u) => [u.id, u.name])} /></Field>
        </div>
        <Submit>Agendar</Submit>
      </ActionForm>
    </Modal>
  );
}

/** Fila de un seguimiento con su cierre (resultado, salud y siguiente paso). */
export function FollowupRow({ f, subject, owner, canEdit }: { f: Followup; subject: React.ReactNode; owner?: string; canEdit: boolean }) {
  const today = todayISO();
  const late = f.status === "pending" && f.dueOn < today;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0">
      <span className={cn("w-16 shrink-0 text-xs font-bold", late ? "text-danger" : f.dueOn === today ? "text-emerald" : "text-muted")}>
        {f.dueOn === today ? "Hoy" : fmtDate(f.dueOn)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{f.title}</span>
        <span className="block truncate text-xs text-muted">
          {subject} · {FOLLOWUP_CHANNEL[f.channel]}{owner ? ` · ${owner}` : ""}{f.reason !== "manual" ? ` · ${FOLLOWUP_REASON[f.reason]}` : ""}
        </span>
        {f.status === "done" && f.outcome && <span className="mt-1 block text-xs text-muted">{f.outcome}{f.completedAt ? ` · ${relative(f.completedAt)}` : ""}</span>}
      </span>
      {late && <Badge tone="red">Atrasado</Badge>}
      {f.health && <Badge tone={HEALTH[f.health].tone}>{HEALTH[f.health].label}</Badge>}
      {f.status === "pending" && canEdit && (
        <>
          <Modal trigger="Registrar" title={f.title} triggerClass={btn("secondary", "sm")}>
            <ActionForm action={completeFollowup}>
              <input type="hidden" name="id" value={f.id} />
              <Field label="¿Cómo fue?"><textarea name="outcome" rows={3} required className={inputCls} placeholder="Usa Ziora para notas, le cuesta el portal del paciente…" /></Field>
              <Field label="¿Cómo lo ves?">
                <div className="flex gap-4 text-sm">
                  {Object.entries(HEALTH).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-1.5"><input type="radio" name="health" value={k} required defaultChecked={k === "green"} className="accent-[#059669]" />{v.label}</label>
                  ))}
                </div>
              </Field>
              <p className="label pt-1">Siguiente paso (opcional)</p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Qué" className="col-span-3"><input name="nextAction" className={inputCls} placeholder="Mandar tutorial del portal" /></Field>
                <Field label="Cuándo"><input name="nextDueOn" type="date" className={inputCls} /></Field>
                <Field label="Canal"><Select name="nextChannel" defaultValue={f.channel} options={Object.entries(FOLLOWUP_CHANNEL)} /></Field>
              </div>
              <Submit>Guardar</Submit>
            </ActionForm>
          </Modal>
          <form action={cancelFollowup}>
            <input type="hidden" name="id" value={f.id} />
            <button className="rounded-full px-2 py-1 text-xs text-faint hover:text-danger" title="Cancelar seguimiento">✕</button>
          </form>
        </>
      )}
      {canEdit && <DeleteButton kind="followup" id={f.id} what={`el seguimiento "${f.title}"`} label="" />}
    </div>
  );
}
