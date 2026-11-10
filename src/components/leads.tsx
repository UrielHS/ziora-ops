"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft, CalendarClock, Cog, FlaskConical, Link2, Mail, MapPin, Megaphone, MessageCircle, Phone, StickyNote, Users, Video } from "lucide-react";
import { addNoteAction, markRepliedAction, markTryingAction, moveLead, postponeAction, recordTouchAction, referralLinkSentAction, setChannelInvalidAction, setLeadStatusAction, setNextActionAction } from "@/actions/leads";
import { enrollAction, stopEnrollmentAction } from "@/actions/sequences";
import { Avatar, Badge, btn, cn, inputCls, Select } from "@/components/ui";
import { Kanban, type KanbanColumn, type KanbanItem } from "@/components/ui/kanban";
import type { contacts, LeadStatus } from "@/db/schema";
import type { TimelineItem } from "@/domain/leads";
import type { Cadence } from "@/domain/sequences";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { CopyButton } from "@/components/ui/copy";
import { fmtDate, fmtDateTime, relative, todayISO } from "@/lib/format";
import { CITY, ENROLLMENT_STATUS, LEAD_PRIORITY, LEAD_STATUS, SEQUENCE_CHANNEL } from "@/lib/labels";

type Lead = typeof contacts.$inferSelect;

export function LeadPriorityBadge({ priority }: { priority: number | null }) {
  const p = LEAD_PRIORITY[priority as keyof typeof LEAD_PRIORITY];
  return p ? <Badge tone={p.tone}>{p.label}</Badge> : null;
}

/** Tarjeta del kanban: lo justo para decidir a quién tocar hoy. La casilla alimenta la barra de acciones en lote. */
export function LeadCard({ c, owner, selectable = true }: { c: Lead; owner?: string | null; selectable?: boolean }) {
  const overdue = !!c.nextActionOn && c.nextActionOn < todayISO();
  const city = c.cityName ?? (c.city ? CITY[c.city] : null);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-3 transition-colors hover:border-emerald/40">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {selectable && <input type="checkbox" name="ids[]" value={c.id} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald" aria-label={`Seleccionar ${c.name}`} />}
          <Link href={`/leads/${c.id}`} className="min-w-0 text-[13.5px] font-bold leading-snug hover:underline">
            {c.name}
          </Link>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted" title={owner ? `Dueño: ${owner}` : "Sin dueño"}>
          {owner ? owner.split(" ")[0] : "Sin dueño"}
          <Avatar name={owner} size={22} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {c.jobTitle && <span className="truncate font-semibold text-ink">{c.jobTitle}</span>}
        {city && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{city}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <LeadPriorityBadge priority={c.priority} />
        {c.segment && <Badge tone="gray">{c.segment}</Badge>}
        <InvalidBadges c={c} />
      </div>
      {c.nextAction && (
        <p className={cn("flex items-center gap-1 text-[11px]", overdue ? "font-semibold text-danger" : "text-muted")}>
          <CalendarClock className="h-3 w-3 shrink-0" />
          <span className="truncate">{c.nextAction}</span>
          {c.nextActionOn && <span className="shrink-0">· {fmtDate(c.nextActionOn)}</span>}
        </p>
      )}
    </div>
  );
}

/** Kanban de leads. Sin permiso de gestión el arrastre avisa en vez de guardar. */
export function LeadsBoard({ columns, items, canManage }: { columns: KanbanColumn[]; items: KanbanItem[]; canManage: boolean }) {
  return (
    <Kanban
      columns={columns}
      items={items}
      minColWidth={230}
      onMove={canManage ? moveLead : async () => ({ error: "Tu rol no tiene permiso para mover leads" })}
    />
  );
}

export function LeadStatusBadge({ status }: { status: LeadStatus | null }) {
  if (!status) return <Badge tone="gray">Sin estado</Badge>;
  const s = LEAD_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const TOUCHES = [
  { channel: "whatsapp", label: "Mandé WhatsApp", icon: MessageCircle },
  { channel: "correo", label: "Mandé correo", icon: Mail },
  { channel: "llamada", label: "Llamé", icon: Phone },
] as const;

/** Un formulario por botón: cada toque es un envío con su canal; "Respondió" es la entrada del lead. */
export function TouchButtons({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TOUCHES.map((t) => (
        <ActionForm key={t.channel} action={recordTouchAction} className="contents">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="channel" value={t.channel} />
          <Submit variant="secondary" className="!py-1.5 !text-xs"><t.icon className="h-3.5 w-3.5" /> {t.label}</Submit>
        </ActionForm>
      ))}
      <ActionForm action={referralLinkSentAction} className="contents">
        <input type="hidden" name="id" value={id} />
        <Submit variant="secondary" className="!py-1.5 !text-xs"><Link2 className="h-3.5 w-3.5" /> Le mandé mi liga</Submit>
      </ActionForm>
      <ActionForm action={markTryingAction} className="contents">
        <input type="hidden" name="id" value={id} />
        <Submit variant="secondary" className="!py-1.5 !text-xs"><FlaskConical className="h-3.5 w-3.5" /> Ya lo está probando</Submit>
      </ActionForm>
      <ActionForm action={markRepliedAction} className="contents">
        <input type="hidden" name="id" value={id} />
        <Submit variant="primary" className="!py-1.5 !text-xs">Respondió</Submit>
      </ActionForm>
    </div>
  );
}

/** Badges rojos cuando el correo o el teléfono están marcados como incorrectos. */
export function InvalidBadges({ c }: { c: { emailInvalidAt?: Date | null; phoneInvalidAt?: Date | null } }) {
  return (
    <>
      {c.emailInvalidAt && <Badge tone="red">Correo incorrecto</Badge>}
      {c.phoneInvalidAt && <Badge tone="red">Teléfono incorrecto</Badge>}
    </>
  );
}

/** Ficha → Datos de contacto: alterna el marcado de correo o teléfono incorrecto. */
export function ChannelInvalidButton({ id, channel, invalid }: { id: string; channel: "email" | "phone"; invalid: boolean }) {
  const label = channel === "email" ? "Correo" : "Teléfono";
  return (
    <ActionForm action={setChannelInvalidAction} className="contents">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="invalid" value={invalid ? "0" : "1"} />
      <Submit variant={invalid ? "secondary" : "ghost"} className="!py-1 !text-xs">
        {invalid ? `${label}: marcar como válido` : `${label} incorrecto`}
      </Submit>
    </ActionForm>
  );
}

export type SellerLinks = { referral: string | null; booking: string | null; discountCode: string | null };

/** Ficha → «Mis ligas»: lo que el vendedor manda al lead (referido con UTM, calendario, código). Sin perfil, manda a Ajustes. */
export function MyLinks({ links }: { links: SellerLinks | null }) {
  const rows: [string, string | null][] = links ? [["Mi liga de referido (con UTM)", links.referral], ["Mi calendario", links.booking], ["Mi código de descuento", links.discountCode]] : [];
  if (!links || !rows.some(([, v]) => v)) {
    return (
      <p className="px-5 pb-5 text-sm text-muted">
        Aún no tienes ligas guardadas. <Link href="/settings" className="font-semibold text-emerald hover:underline">Configura tus ligas en Ajustes</Link> y aparecerán aquí para copiarlas.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2 px-5 pb-5">
      {rows.map(([label, value]) => value && (
        <li key={label} className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-[#FBFAF6] px-3 py-2">
          <div className="min-w-0">
            <p className="label">{label}</p>
            <p className="truncate text-sm">{value}</p>
          </div>
          <CopyButton text={value} />
        </li>
      ))}
    </ul>
  );
}

export function NextActionForm({ id, text, on }: { id: string; text: string | null; on: string | null }) {
  return (
    <ActionForm action={setNextActionAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input name="text" defaultValue={text ?? ""} placeholder="Qué sigue: proponer demo, mandar recordatorio…" className={inputCls} />
        <input type="date" name="on" defaultValue={on ?? ""} className={cn(inputCls, "sm:w-40")} />
      </div>
      <div className="flex gap-2">
        <Submit variant="secondary" className="!py-1.5 !text-xs">Guardar siguiente paso</Submit>
      </div>
    </ActionForm>
  );
}

/** Cambio manual de estado. Perdido pide el motivo; es lo único que no se hace arrastrando en el kanban. */
export function LeadStatusForm({ id, status }: { id: string; status: LeadStatus | null }) {
  const [next, setNext] = useState<string>(status ?? "nuevo");
  return (
    <ActionForm action={setLeadStatusAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <select name="status" value={next} onChange={(e) => setNext(e.target.value)} className={cn(inputCls, "pr-8")}>
          {Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Submit variant={next === "perdido" ? "danger" : "secondary"} className="!py-1.5 !text-xs">{next === "perdido" ? "Marcar perdido" : "Cambiar estado"}</Submit>
      </div>
      {next === "perdido" && <input name="lostReason" required placeholder="Motivo: no le interesa, ya usa otra herramienta, sin presupuesto…" className={inputCls} />}
    </ActionForm>
  );
}

export function NoteForm({ id }: { id: string }) {
  return (
    <ActionForm action={addNoteAction} resetOnSuccess className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <textarea name="text" rows={2} required placeholder="Nota rápida: qué dijo, qué le preocupa, qué prometimos…" className={inputCls} />
      <div><Submit variant="secondary" className="!py-1.5 !text-xs"><StickyNote className="h-3.5 w-3.5" /> Guardar nota</Submit></div>
    </ActionForm>
  );
}

const KIND_ICON: Record<TimelineItem["kind"], React.ComponentType<{ className?: string }>> = {
  nota: StickyNote, whatsapp: MessageCircle, correo: Mail, llamada: Phone, reunion: Users, cambio_estado: ArrowRightLeft,
  demo: Video, campana: Megaphone, secuencia: Megaphone, sistema: Cog, campaign_send: Megaphone,
};

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="text-sm text-muted">Todavía no hay nada registrado.</p>;
  return (
    <ol className="flex flex-col">
      {items.map((it, i) => {
        const Icon = KIND_ICON[it.kind] ?? Cog;
        const inbound = it.direction === "entrante";
        return (
          <li key={i} className="flex gap-3 border-b border-[#EFEDE6] py-2.5 last:border-b-0">
            <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", inbound ? "bg-mint text-emerald" : "bg-[#F1F0EA] text-muted")}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{it.title}</p>
              {it.detail && <p className="text-xs text-muted">{it.detail}</p>}
              <p className="text-[11px] text-faint" title={fmtDateTime(it.at)}>
                {relative(it.at)}{it.actor ? ` · ${it.actor}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function WhatsAppButton({ href, children = "Abrir WhatsApp" }: { href: string | null; children?: React.ReactNode }) {
  if (!href) return <span className={cn(btn("secondary", "sm"), "cursor-not-allowed opacity-50")} title="Sin teléfono válido"><MessageCircle className="h-3.5 w-3.5" /> {children}</span>;
  return <a href={href} target="_blank" rel="noreferrer" className={btn("secondary", "sm")}><MessageCircle className="h-3.5 w-3.5" /> {children}</a>;
}

const STOP_REASON: Record<string, string> = {
  completada: "sin respuesta", sin_canal: "sin canal disponible", tope: "tope de toques", respondio: "respondió", baja: "baja de correo",
  perdido: "lead perdido", manual: "detenida a mano", demo_agendada: "demo agendada", en_trial: "entró a trial", pago: "pagó", rollback: "rollback",
};

/** Etiqueta corta de la cadencia: "Toque 2 de 4 · WhatsApp" si hay pendiente, o la secuencia y su siguiente paso. */
export function CadenceBadge({ cadence }: { cadence?: Cadence }) {
  if (!cadence) return null;
  if (cadence.status !== "activa") {
    const st = ENROLLMENT_STATUS[cadence.status];
    return <Badge tone={st.tone}>Secuencia {st.label.toLowerCase()}{cadence.stopReason ? ` · ${STOP_REASON[cadence.stopReason] ?? cadence.stopReason}` : ""}</Badge>;
  }
  if (cadence.pendingText && cadence.nextChannel) {
    return <Badge tone="green"><Megaphone className="mr-1 h-3 w-3" />Toque {cadence.touches + 1} de {cadence.total} · {SEQUENCE_CHANNEL[cadence.nextChannel]}</Badge>;
  }
  return (
    <Badge tone="gray">
      <Megaphone className="mr-1 h-3 w-3" />Secuencia «{cadence.sequenceName}»
      {cadence.nextChannel ? ` · siguiente: ${SEQUENCE_CHANNEL[cadence.nextChannel]}${cadence.nextRunAt ? ` ${fmtDate(cadence.nextRunAt)}` : ""}` : ""}
    </Badge>
  );
}

/** Fila de "Mi día": todo lo necesario para despachar un lead sin abrir la ficha. Si la secuencia dejó un WhatsApp listo, ese es el mensaje. */
export function TodayRow({ c, owner, message, wa, cadence }: { c: Lead; owner?: string | null; message: string; wa: string | null; cadence?: Cadence }) {
  const overdue = !!c.nextActionOn && c.nextActionOn < todayISO();
  const fromSequence = cadence?.status === "activa" && !!cadence.pendingText;
  const text = fromSequence ? cadence.pendingText! : message;
  return (
    <div className="flex flex-col gap-3 border-b border-[#EFEDE6] px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/leads/${c.id}`} className="text-sm font-bold hover:underline">{c.name}</Link>
        <LeadPriorityBadge priority={c.priority} />
        <LeadStatusBadge status={c.leadStatus} />
        <CadenceBadge cadence={cadence} />
        <InvalidBadges c={c} />
        {c.jobTitle && <span className="text-xs text-muted">{c.jobTitle}</span>}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted"><Avatar name={owner} size={18} />{owner ?? "Sin dueño"}</span>
      </div>
      {c.nextAction && (
        <p className={cn("flex items-center gap-1 text-xs", overdue ? "font-semibold text-danger" : "text-muted")}>
          <CalendarClock className="h-3.5 w-3.5" />{c.nextAction}{c.nextActionOn && <span>· {fmtDate(c.nextActionOn)}</span>}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-line bg-[#FBFAF6] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="label">{fromSequence ? `Mensaje de la secuencia «${cadence.sequenceName}»` : "Mensaje sugerido"}</p>
            <CopyButton text={text} />
          </div>
          <textarea readOnly value={text} rows={3} className="mt-1 w-full resize-none bg-transparent text-sm outline-none" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {!c.phoneInvalidAt && <WhatsAppButton href={wa}>WhatsApp</WhatsAppButton>}
            <ActionForm action={recordTouchAction} className="contents">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="channel" value="whatsapp" />
              <Submit variant="secondary" className="!py-1.5 !text-xs">Ya lo mandé</Submit>
            </ActionForm>
            <ActionForm action={recordTouchAction} className="contents">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="channel" value="correo" />
              <Submit variant="ghost" className="!py-1.5 !text-xs"><Mail className="h-3.5 w-3.5" /> Mandé correo</Submit>
            </ActionForm>
            <ActionForm action={markRepliedAction} className="contents">
              <input type="hidden" name="id" value={c.id} />
              <Submit variant="primary" className="!py-1.5 !text-xs">Respondió</Submit>
            </ActionForm>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm action={postponeAction} className="contents">
              <input type="hidden" name="id" value={c.id} />
              <span className="text-[11px] text-muted">Posponer</span>
              {[1, 3, 7].map((d) => <Submit key={d} variant="ghost" name="days" value={String(d)} className="!px-2.5 !py-1 !text-xs">{d} {d === 1 ? "día" : "días"}</Submit>)}
            </ActionForm>
            <Modal title={`Marcar perdido a ${c.name}`} triggerClass={cn(btn("ghost", "sm"), "ml-auto text-danger")} trigger={<>Perdido</>}>
              <ActionForm action={setLeadStatusAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="status" value="perdido" />
                <input name="lostReason" required autoFocus placeholder="Motivo: no le interesa, ya usa otra herramienta, sin presupuesto…" className={inputCls} />
                <Submit variant="danger">Marcar perdido</Submit>
              </ActionForm>
            </Modal>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ficha: estado de la cadencia del lead. Enrolar si no hay una activa; detener si la hay. */
export function CadencePanel({ contactId, cadence, sequences, canManage }: {
  contactId: string; cadence?: Cadence; sequences: { id: string; name: string }[]; canManage: boolean;
}) {
  const active = cadence?.status === "activa";
  return (
    <div className="flex flex-col gap-3">
      {cadence ? (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">«{cadence.sequenceName}»</span>
            <Badge tone={ENROLLMENT_STATUS[cadence.status].tone}>{ENROLLMENT_STATUS[cadence.status].label}</Badge>
            <span className="text-xs text-muted">{cadence.touches} de {cadence.total} toques</span>
          </div>
          {active && cadence.pendingText && cadence.nextChannel && (
            <p className="text-xs text-muted">Toque {cadence.touches + 1} listo por {SEQUENCE_CHANNEL[cadence.nextChannel]}: mándalo desde Mi día y marca «Ya lo mandé».</p>
          )}
          {active && !cadence.pendingText && cadence.nextChannel && (
            <p className="text-xs text-muted">Siguiente: {SEQUENCE_CHANNEL[cadence.nextChannel]}{cadence.nextRunAt ? ` · ${fmtDateTime(cadence.nextRunAt)}` : ""}</p>
          )}
          {!active && cadence.stopReason && <p className="text-xs text-muted">Motivo: {STOP_REASON[cadence.stopReason] ?? cadence.stopReason}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">Este lead no está en ninguna secuencia.</p>
      )}
      {canManage && active && (
        <ActionForm action={stopEnrollmentAction} className="contents">
          <input type="hidden" name="id" value={contactId} />
          <Submit variant="ghost" className="!py-1.5 !text-xs text-danger">Detener secuencia</Submit>
        </ActionForm>
      )}
      {canManage && !active && sequences.length > 0 && (
        <ActionForm action={enrollAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="ids[]" value={contactId} />
          <Select name="sequenceId" defaultValue={sequences[0]?.id} className="w-auto py-1.5 text-xs" options={sequences.map((s) => [s.id, s.name] as [string, string])} />
          <Submit variant="secondary" className="!py-1.5 !text-xs">Enrolar</Submit>
        </ActionForm>
      )}
      {canManage && !active && sequences.length === 0 && <p className="text-xs text-faint">No hay secuencias activas (docs/RUNBOOK-CRM-LEADS.md §7).</p>}
    </div>
  );
}
