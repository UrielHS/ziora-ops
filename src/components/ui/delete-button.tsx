"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteRecord, type DeleteKind } from "@/actions/delete";
import { cn } from "@/components/ui";

/**
 * Botón Eliminar con confirmación. `warning` explica qué más se borra o cambia (registros relacionados).
 * `redirectTo` lleva a otra página al terminar (p. ej. al borrar la cuenta que estás viendo).
 */
export function DeleteButton({
  kind, id, what, warning, redirectTo, className, label = "Eliminar",
}: { kind: DeleteKind; id: string; what: string; warning?: string; redirectTo?: string; className?: string; label?: string }) {
  const [state, action, pending] = useActionState(deleteRecord, {});
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && redirectTo) router.push(redirectTo);
  }, [state, redirectTo, router]);
  return (
    <form
      ref={form}
      action={action}
      onSubmit={(e) => {
        const msg = `¿Eliminar ${what}?${warning ? `\n\n${warning}` : ""}\n\nEsto no se puede deshacer.`;
        if (!window.confirm(msg)) e.preventDefault();
      }}
      className={cn("inline-flex flex-col items-start gap-1", className)}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-bg disabled:opacity-50">
        <Trash2 className="h-3.5 w-3.5" />{pending ? "Eliminando…" : label}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
