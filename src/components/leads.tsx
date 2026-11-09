"use client";

import Link from "next/link";
import { CalendarClock, MapPin } from "lucide-react";
import { moveLead } from "@/actions/leads";
import { Avatar, Badge, cn } from "@/components/ui";
import { Kanban, type KanbanColumn, type KanbanItem } from "@/components/ui/kanban";
import type { contacts } from "@/db/schema";
import { fmtDate, todayISO } from "@/lib/format";
import { CITY, LEAD_PRIORITY } from "@/lib/labels";

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
