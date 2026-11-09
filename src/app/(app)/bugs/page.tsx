import Link from "next/link";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { bugToTask, createBug, setBugStatus, updateBug } from "@/actions/bugs";
import { Avatar, Badge, btn, Card, cn, Field, inputCls, PageHeader, Select } from "@/components/ui";
import { ActionForm, AutoSelect, Modal, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { bugs, bugSeverityEnum, tasks } from "@/db/schema";
import { fmtDate, relative } from "@/lib/format";
import { BUG_SEVERITY, BUG_SOURCE, BUG_STATUS } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";

export const dynamic = "force-dynamic";
const OPEN = ["new", "triaged", "in_progress"] as const;
const AREAS = ["Checkout / Stripe", "Grabación", "Transcripción", "Nota clínica", "Videollamada", "Compartir pantalla", "Portal del paciente", "Escalas", "Copilot", "Referidos", "Landing", "Onboarding", "Otro"];

export default async function BugsPage({ searchParams }: { searchParams: Promise<{ show?: string; severity?: string; nuevo?: string }> }) {
  const sp = await searchParams;
  const show = sp.show ?? "open";
  const where: SQL[] = [];
  if (show === "open") where.push(inArray(bugs.status, [...OPEN]));
  if (show === "fixed") where.push(inArray(bugs.status, ["fixed", "verified"]));
  if (sp.severity) where.push(eq(bugs.severity, sp.severity as (typeof bugSeverityEnum.enumValues)[number]));
  const [users, rows, open, linked] = await Promise.all([
    listUsers(),
    db.select().from(bugs).where(where.length ? and(...where) : undefined).orderBy(asc(bugs.severity), desc(bugs.createdAt)),
    db.select({ severity: bugs.severity }).from(bugs).where(inArray(bugs.status, [...OPEN])),
    db.select({ bugId: tasks.bugId, number: tasks.number }).from(tasks),
  ]);
  const sev = (s: string) => open.filter((b) => b.severity === s).length;
  const statusOpts = Object.entries(BUG_STATUS).map(([k, v]) => [k, v.label] as [string, string]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Producto"
        title="QA y bugs"
        subtitle="Registro manual, el botón 'Reportar un problema' de la app (POST /api/bugs) y, más adelante, Sentry."
        actions={
          <Modal trigger="+ Reportar bug" title="Reportar bug" defaultOpen={sp.nuevo === "1"}>
            <ActionForm action={createBug}>
              <Field label="Qué falla"><input name="title" required className={inputCls} placeholder="El checkout no termina con tarjeta de débito" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Severidad"><Select name="severity" defaultValue="medium" options={Object.entries(BUG_SEVERITY).map(([k, v]) => [k, v.label])} /></Field>
                <Field label="Área"><Select name="area" placeholder="—" options={AREAS.map((a) => [a, a])} /></Field>
                <Field label="Entorno"><Select name="environment" defaultValue="production" options={[["production", "Producción"], ["staging", "Staging"], ["local", "Local"]]} /></Field>
                <Field label="Dispositivo / navegador"><input name="device" className={inputCls} placeholder="iPad Safari 18" /></Field>
              </div>
              <Field label="Pasos para reproducir"><textarea name="stepsToReproduce" rows={3} className={inputCls} placeholder={"1. Entrar a Planes\n2. Elegir Pro\n3. …"} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Esperado"><textarea name="expected" rows={2} className={inputCls} /></Field>
                <Field label="Obtenido"><textarea name="actual" rows={2} className={inputCls} /></Field>
              </div>
              <Field label="Responsable"><Select name="assigneeId" placeholder="Sin asignar" options={users.map((u) => [u.id, u.name])} /></Field>
              <p className="rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn">No incluyas datos de pacientes, notas ni transcripciones. Solo lo técnico.</p>
              <Submit>Registrar</Submit>
            </ActionForm>
          </Modal>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["critical", "high", "medium", "low"] as const).map((s) => (
          <Link key={s} href={`/bugs?show=open&severity=${s}`} className={cn("card p-4 hover:border-emerald/40", s === "critical" && sev(s) > 0 && "border-danger/40 bg-danger-bg/50")}>
            <p className="label">{BUG_SEVERITY[s].label}s abiertos</p>
            <p className={cn("mt-1 text-2xl font-extrabold", s === "critical" && sev(s) > 0 && "text-danger")}>{sev(s)}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[["open", "Abiertos"], ["fixed", "Corregidos"], ["all", "Todos"]].map(([k, l]) => (
          <Link key={k} href={`/bugs?show=${k}`} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", show === k && !sp.severity ? "bg-mint text-emerald" : "border border-line bg-white text-muted")}>{l}</Link>
        ))}
        {sp.severity && <Badge tone={BUG_SEVERITY[sp.severity as keyof typeof BUG_SEVERITY]?.tone}>Filtro: {BUG_SEVERITY[sp.severity as keyof typeof BUG_SEVERITY]?.label} <Link href={`/bugs?show=${show}`} className="ml-1">×</Link></Badge>}
      </div>

      <Card>
        {rows.length === 0 && <p className="p-6 text-sm text-muted">Nada por aquí. 🎉</p>}
        {rows.map((b) => {
          const assignee = users.find((u) => u.id === b.assigneeId);
          const task = linked.find((t) => t.bugId === b.id);
          return (
            <div key={b.id} className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0">
              <Badge tone={BUG_SEVERITY[b.severity].tone} className="w-16 justify-center">{BUG_SEVERITY[b.severity].label}</Badge>
              <Modal
                title={`BUG-${b.number}`}
                wide
                triggerClass="min-w-0 flex-1 text-left"
                trigger={
                  <span className="block min-w-0">
                    <span className="block truncate text-sm font-semibold hover:text-emerald">
                      <span className="mr-2 text-xs font-semibold text-faint">BUG-{b.number}</span>{b.title}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {b.area ?? "Sin área"} · {BUG_SOURCE[b.source]}{b.occurrences > 1 ? ` · ${b.occurrences} veces` : ""} · {relative(b.createdAt)}
                      {task ? ` · ZOP-${task.number}` : ""}
                    </span>
                  </span>
                }
              >
                <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
                  <div className="flex flex-col gap-3 text-sm">
                    <p className="text-base font-bold">{b.title}</p>
                    {[["Pasos", b.stepsToReproduce], ["Esperado", b.expected], ["Obtenido", b.actual], ["Descripción", b.description]].map(([l, v]) =>
                      v ? <div key={l}><p className="label">{l}</p><p className="mt-0.5 whitespace-pre-wrap">{v}</p></div> : null,
                    )}
                    <p className="text-xs text-muted">
                      {b.environment} · {b.device ?? "dispositivo no indicado"} · {b.appVersion ? `v${b.appVersion} · ` : ""}reportó {b.reporterEmail ?? "—"} · {fmtDate(b.createdAt, { dateStyle: "medium" })}
                    </p>
                    {b.externalUrl && <a href={b.externalUrl} target="_blank" className="text-xs text-emerald underline">Ver en {BUG_SOURCE[b.source]}</a>}
                    {!task && (
                      <form action={bugToTask}>
                        <input type="hidden" name="id" value={b.id} />
                        <button className={btn("secondary", "sm")}>Crear tarea en el sprint</button>
                      </form>
                    )}
                  </div>
                  <ActionForm action={updateBug}>
                    <input type="hidden" name="id" value={b.id} />
                    <Field label="Estado"><Select name="status" defaultValue={b.status} options={statusOpts} /></Field>
                    <Field label="Severidad"><Select name="severity" defaultValue={b.severity} options={Object.entries(BUG_SEVERITY).map(([k, v]) => [k, v.label])} /></Field>
                    <Field label="Área"><Select name="area" defaultValue={b.area} placeholder="—" options={AREAS.map((a) => [a, a])} /></Field>
                    <Field label="Responsable"><Select name="assigneeId" defaultValue={b.assigneeId} placeholder="Sin asignar" options={users.map((u) => [u.id, u.name])} /></Field>
                    <Field label="PR que lo corrige"><input name="prUrl" type="url" defaultValue={b.prUrl ?? ""} className={inputCls} placeholder="https://github.com/…/pull/221" /></Field>
                    <Submit>Guardar</Submit>
                  </ActionForm>
                  <div className="border-t border-line pt-3">
                    <DeleteButton kind="bug" id={b.id} what={`BUG-${b.number}`} warning="Los tickets ligados a este bug se quedan, sin el enlace." label="Eliminar bug" />
                  </div>
                </div>
              </Modal>
              <span className="hidden sm:block"><Avatar name={assignee?.name} size={24} /></span>
              <AutoSelect action={setBugStatus} name="status" value={b.status} options={statusOpts} hidden={{ id: b.id }} />
            </div>
          );
        })}
      </Card>
    </div>
  );
}
