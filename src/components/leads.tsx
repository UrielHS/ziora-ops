"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft, CalendarClock, Cog, Mail, MapPin, Megaphone, MessageCircle, Phone, StickyNote, Users, Video } from "lucide-react";
import { addNoteAction, markRepliedAction, moveLead, postponeAction, recordTouchAction, setLeadStatusAction, setNextActionAction } from "@/actions/leads";
import { Avatar, Badge, btn, cn, inputCls } from "@/components/ui";
import { Kanban, type KanbanColumn, type KanbanItem } from "@/components/ui/kanban";
import type { contacts, LeadStatus } from "@/db/schema";
import type { TimelineItem } from "@/domain/leads";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { CopyButton } from "@/components/ui/copy";
import { fmtDate, fmtDateTime, relative, todayISO } from "@/lib/format";
import { CITY, LEAD_PRIORITY, LEAD_STATUS } from "@/lib/labels";

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
        <Avatar name={owner} size={22} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {c.jobTitle && <span className="truncate font-semibold text-ink">{c.jobTitle}</span>}
        {city && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{city}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <LeadPriorityBadge priority={c.priority} />
        {c.segment && <Badge tone="gray">{c.segment}</Badge>}
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
      <ActionForm action={markRepliedAction} className="contents">
        <input type="hidden" name="id" value={id} />
        <Submit variant="primary" className="!py-1.5 !text-xs">Respondió</Submit>
      </ActionForm>
    </div>
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

/** Fila de "Mi día": todo lo necesario para despachar un lead sin abrir la ficha. */
export function TodayRow({ c, owner, message, wa }: { c: Lead; owner?: string | null; message: string; wa: string | null }) {
  const overdue = !!c.nextActionOn && c.nextActionOn < todayISO();
  return (
    <div className="flex flex-col gap-3 border-b border-[#EFEDE6] px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/leads/${c.id}`} className="text-sm font-bold hover:underline">{c.name}</Link>
        <LeadPriorityBadge priority={c.priority} />
        <LeadStatusBadge status={c.leadStatus} />
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
            <p className="label">Mensaje sugerido</p>
            <CopyButton text={message} />
          </div>
          <textarea readOnly value={message} rows={3} className="mt-1 w-full resize-none bg-transparent text-sm outline-none" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <WhatsAppButton href={wa}>WhatsApp</WhatsAppButton>
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
