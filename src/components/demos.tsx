import { MapPin, MessageCircle, Video } from "lucide-react";
import { createDemo, demoFollowUpTask, updateDemo } from "@/actions/demos";
import { Avatar, Badge, btn, Field, inputCls, Progress, Select, cn } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import type { UserOption } from "@/db/queries";
import type { demoRequests } from "@/db/schema";
import { CITY, DEMO_STAGE } from "@/lib/labels";
import { fmtDate, fmtDateTime, waLink } from "@/lib/format";
import { DeleteButton } from "@/components/ui/delete-button";

type Demo = typeof demoRequests.$inferSelect & { city?: string | null };

function toLocalInput(d: Date | null) {
  if (!d) return "";
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" }).format(d);
  return s.replace(" ", "T");
}

export function trialDay(d: Demo) {
  if (!d.trialStartedAt) return null;
  return Math.min(14, Math.max(1, Math.ceil((Date.now() - d.trialStartedAt.getTime()) / 86_400_000)));
}

export function DemoCard({ d, users }: { d: Demo; users: UserOption[] }) {
  const owner = users.find((u) => u.id === d.ownerId);
  const wa = waLink(d.whatsapp, `Hola ${d.fullName.split(" ").slice(-2, -1)[0] ?? ""}, te escribo de Ziora sobre tu demo.`);
  const day = d.stage === "trial" ? trialDay(d) : null;
  return (
    <Modal
      title={d.fullName}
      wide
      triggerClass="w-full rounded-2xl border border-line bg-white p-3 text-left transition-colors hover:border-emerald/40"
      trigger={
        <span className="flex flex-col gap-2">
          <span className="flex items-start justify-between gap-2">
            <span className="text-[13.5px] font-bold leading-snug">{d.fullName}</span>
            <Avatar name={owner?.name} size={22} />
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {d.city && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{CITY[d.city as keyof typeof CITY] ?? d.city}</span>}
            {d.patientsPerWeek && <span>· {d.patientsPerWeek} pac/sem</span>}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {d.teletherapy === "Sí" && <Badge tone="blue"><Video className="mr-1 h-3 w-3" />Teleterapia</Badge>}
            {d.scheduledAt && d.stage === "scheduled" && <Badge tone="green">{fmtDateTime(d.scheduledAt)}</Badge>}
            {d.stage === "lost" && d.lostReason && <Badge tone="red">{d.lostReason}</Badge>}
            {d.stage === "no_show" && <Badge tone="red">No asistió</Badge>}
          </span>
          {day && (
            <span className="flex items-center gap-2">
              <Progress value={day} max={14} tone={day > 11 ? "amber" : "green"} />
              <span className="whitespace-nowrap text-[11px] font-semibold text-muted">Día {day}/14</span>
            </span>
          )}
          <span className="flex items-center justify-between text-[11px] text-faint">
            <span>{d.source === "manual" ? "Registro manual" : d.source.startsWith("Google Calendar") ? "Calendario del CEO" : "ziora-copilot.com/demo"}</span>
            {wa && <MessageCircle className="h-3.5 w-3.5 text-emerald" />}
          </span>
        </span>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-3 text-sm">
          <Info label="Correo" value={d.email} />
          <Info label="WhatsApp" value={d.whatsapp ?? "—"} />
          <Info label="Pacientes por semana" value={d.patientsPerWeek ?? "—"} />
          <Info label="¿Teleterapia?" value={d.teletherapy ?? "—"} />
          <Info label="Lo que más le quita tiempo" value={d.painPoint ?? "—"} />
          <Info label="Solicitada" value={fmtDate(d.createdAt, { dateStyle: "medium" })} />
          {typeof d.raw.calendarLink === "string" && (
            <a href={d.raw.calendarLink} target="_blank" className="text-xs text-emerald underline">Abrir evento en Google Calendar</a>
          )}
          {Object.keys(d.utm).length > 0 && <Info label="UTM" value={Object.entries(d.utm).map(([k, v]) => `${k}=${v}`).join(" · ")} />}
          <div className="flex flex-wrap gap-2 pt-1">
            {wa && <a href={wa} target="_blank" className={btn("secondary", "sm")}><MessageCircle className="h-3.5 w-3.5" /> Abrir WhatsApp</a>}
            <form action={demoFollowUpTask}>
              <input type="hidden" name="id" value={d.id} />
              <button className={btn("ghost", "sm")}>Crear tarea de seguimiento</button>
            </form>
          </div>
        </div>
        <ActionForm action={updateDemo}>
          <input type="hidden" name="id" value={d.id} />
          <Field label="Etapa">
            <Select name="stage" defaultValue={d.stage} options={Object.entries(DEMO_STAGE).map(([k, v]) => [k, v.label])} />
          </Field>
          <Field label="Fecha y hora de la demo (CDMX)">
            <input type="datetime-local" name="scheduledAt" defaultValue={toLocalInput(d.scheduledAt)} className={inputCls} />
          </Field>
          <Field label="Responsable">
            <Select name="ownerId" defaultValue={d.ownerId} placeholder="Sin asignar" options={users.map((u) => [u.id, u.name])} />
          </Field>
          <Field label="Notas de la llamada">
            <textarea name="notes" rows={4} defaultValue={d.notes ?? ""} className={inputCls} placeholder="Qué le interesó, objeciones, siguiente paso…" />
          </Field>
          <Field label="Motivo si se perdió">
            <input name="lostReason" defaultValue={d.lostReason ?? ""} className={inputCls} placeholder="Precio, timing, ya usa otra herramienta…" />
          </Field>
          <Submit>Guardar</Submit>
        </ActionForm>
        <div className="border-t border-line pt-3">
          <DeleteButton kind="demo" id={d.id} what={`la demo de ${d.fullName}`} warning="El contacto se queda en Contactos. Los seguimientos ligados a la demo se quedan, sin el enlace." label="Eliminar demo" />
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-0.5 break-words">{value}</p>
    </div>
  );
}

export function NewDemoButton({ users, defaultOpen }: { users: UserOption[]; defaultOpen?: boolean }) {
  return (
    <Modal trigger="+ Registrar demo" title="Registrar demo" defaultOpen={defaultOpen}>
      <ActionForm action={createDemo}>
        <p className="rounded-xl bg-mint px-3 py-2 text-xs text-emerald">
          Las solicitudes de ziora-copilot.com/demo entran solas por webhook. Usa esto para demos que llegan por otro lado.
        </p>
        <Field label="Nombre completo"><input name="fullName" required className={inputCls} placeholder="Psic. Nombre Apellido" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Correo"><input type="email" name="email" required className={inputCls} /></Field>
          <Field label="WhatsApp"><input name="whatsapp" className={inputCls} placeholder="+52 55…" /></Field>
          <Field label="Ciudad"><Select name="city" placeholder="—" options={[["CDMX", "CDMX"], ["Guadalajara", "Guadalajara"], ["Monterrey", "Monterrey"], ["Otra", "Otra"]]} /></Field>
          <Field label="Pacientes por semana"><Select name="patientsPerWeek" placeholder="—" options={[["1-9", "1–9"], ["10-20", "10–20"], ["21-30", "21–30"], ["30+", "Más de 30"]]} /></Field>
          <Field label="¿Teleterapia?"><Select name="teletherapy" placeholder="—" options={[["Sí", "Sí"], ["No", "No"]]} /></Field>
          <Field label="Fecha y hora (opcional)"><input type="datetime-local" name="scheduledAt" className={inputCls} /></Field>
        </div>
        <Field label="¿Qué le quita más tiempo?"><input name="painPoint" maxLength={300} className={inputCls} /></Field>
        <Field label="Responsable"><Select name="ownerId" placeholder="Sin asignar" options={users.map((u) => [u.id, u.name])} /></Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="marketingOptIn" className="mt-0.5 h-4 w-4 accent-[#059669]" />
          <span>Aceptó recibir correos de Ziora <span className="text-faint">(solo si lo dijo explícitamente)</span></span>
        </label>
        <Submit>Registrar</Submit>
      </ActionForm>
    </Modal>
  );
}
