"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { btn, cn } from "./index";

const ModalCtx = createContext<{ close: () => void } | null>(null);
const PendingCtx = createContext(false);

export function Modal({
  trigger, title, children, triggerClass, wide, defaultOpen,
}: {
  trigger: React.ReactNode; title: string; children: React.ReactNode; triggerClass?: string; wide?: boolean; defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <>
      <button type="button" className={triggerClass ?? btn("primary")} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className={cn(
          "m-auto w-[calc(100%-32px)] rounded-3xl border border-line bg-cream p-0 text-ink backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        {open && (
          <ModalCtx.Provider value={{ close: () => setOpen(false) }}>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h3 className="font-bold">{title}</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-muted hover:bg-white" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-6 py-5">{children}</div>
          </ModalCtx.Provider>
        )}
      </dialog>
    </>
  );
}

export function Submit({ children, variant = "primary", className, name, value, disabled }: {
  children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; className?: string;
  /** Para formularios con varios botones: el servidor recibe name=value del botón presionado. */
  name?: string; value?: string; disabled?: boolean;
}) {
  const status = useFormStatus();
  const pending = useContext(PendingCtx) || status.pending;
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={cn(btn(variant), className)}>
      {pending ? "Guardando…" : children}
    </button>
  );
}

/** Formulario con server action que devuelve { ok, error }. Si está dentro de un Modal, lo cierra al terminar bien. */
export function ActionForm({
  action, children, className, resetOnSuccess,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const modal = useContext(ModalCtx);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.ok) {
      modal?.close();
      if (resetOnSuccess) formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    // onSubmit en vez de action={}: React 19 vacía el formulario tras cada envío con action,
    // y si el servidor devuelve un error el usuario perdería lo que escribió.
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        // Incluye el botón presionado (name/value) para formularios con varias acciones.
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
      className={className ?? "flex flex-col gap-4"}
    >
      <PendingCtx.Provider value={pending}>{children}</PendingCtx.Provider>
      {state.error && <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state.ok && state.message && <p className="rounded-xl bg-mint px-3 py-2 text-sm text-emerald">{state.message}</p>}
    </form>
  );
}

/** Select que guarda al cambiar (cambio de estado en listas). */
export function AutoSelect({
  action, name, value, options, hidden, className,
}: {
  action: (fd: FormData) => Promise<void>;
  name: string;
  value: string;
  options: [string, string][];
  hidden: Record<string, string>;
  className?: string;
}) {
  return (
    <form action={action}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select
        name={name}
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={cn("cursor-pointer rounded-full border border-line bg-white px-2.5 py-1 text-xs font-semibold text-muted outline-none hover:border-emerald/50", className)}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </form>
  );
}
