"use client";

import { useOptimistic, useState, useTransition } from "react";
import { cn } from "./index";

export type KanbanColumn = { id: string; label: string; accent?: string };
export type KanbanItem = { id: string; column: string; node: React.ReactNode };

/** Tablero con arrastrar y soltar nativo. Al soltar llama onMove(id, columna) y actualiza en optimista. */
export function Kanban({
  columns, items, onMove, minColWidth = 260,
}: {
  columns: KanbanColumn[];
  items: KanbanItem[];
  /** Devuelve { error } para avisar sin guardar; el tablero vuelve a su estado. */
  onMove: (id: string, column: string) => Promise<void | { error?: string }>;
  minColWidth?: number;
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, move] = useOptimistic(items, (state, m: { id: string; column: string }) =>
    state.map((i) => (i.id === m.id ? { ...i, column: m.column } : i)),
  );

  return (
    <div className="flex flex-col gap-2">
    {error && <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const colItems = optimistic.filter((i) => i.column === col.id);
        return (
          <div
            key={col.id}
            className="flex flex-1 shrink-0 flex-col rounded-2xl bg-[#EFEDE5]/70 p-2"
            style={{ minWidth: minColWidth }}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add("ring-2", "ring-emerald/30");
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove("ring-2", "ring-emerald/30")}
            onDrop={(e) => {
              e.currentTarget.classList.remove("ring-2", "ring-emerald/30");
              const id = e.dataTransfer.getData("text/plain");
              if (!id) return;
              start(async () => {
                move({ id, column: col.id });
                setError(null);
                const r = await onMove(id, col.id);
                if (r && r.error) setError(r.error);
              });
            }}
          >
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
                <span className={cn("h-2 w-2 rounded-full", col.accent ?? "bg-faint")} />
                {col.label}
              </span>
              <span className="rounded-full bg-white px-2 text-[11px] font-semibold text-faint">{colItems.length}</span>
            </div>
            <div className="flex min-h-24 flex-col gap-2">
              {colItems.map((i) => (
                <div
                  key={i.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", i.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  {i.node}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
