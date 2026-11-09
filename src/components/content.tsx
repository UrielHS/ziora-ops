import { createPiece, updatePiece } from "@/actions/content";
import { Badge, Field, inputCls, Select, cn } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import type { PieceReview } from "@/db/content-review";
import type { UserOption } from "@/db/queries";
import type { contentPieces } from "@/db/schema";
import { CONTENT_CHANNEL, CONTENT_PILLAR, CONTENT_STATUS, LEGAL_CHECKLIST, OPS_ROLE, RISK } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";

type Piece = typeof contentPieces.$inferSelect;

const PILLAR_DOT: Record<string, string> = {
  producto: "#059669", ia_psicoterapia: "#1D5FA8", estudios: "#6B4FA8", roi: "#D99A2B", psicoterapia_moderna: "#3B8EA5", memes: "#E0607E",
};
export const pillarColor = (p: string) => PILLAR_DOT[p] ?? "#9CA3AF";

/** Canales que siempre lleva una pieza nueva. LinkedIn se agrega cuando es educativa. */
const DEFAULT_CHANNELS = ["tiktok", "instagram", "facebook"];
const CHANNEL_ORDER = ["tiktok", "instagram", "facebook", "linkedin", "facebook_group", "blog", "email"] as const;

export const channelsOf = (p: Pick<Piece, "channel" | "channels">) => (p.channels.length ? p.channels : [p.channel]);

/** Estado de revisión de una pieza programada (o enviada a revisión) para mostrarlo en el calendario. */
export function reviewState(p: Piece, review?: PieceReview): "unreviewed" | "changes" | "reviewed" | null {
  if (!p.reviewRequestedAt || !["legal_review", "scheduled"].includes(p.status)) return null;
  if (!review) return "unreviewed";
  if (review.changesRequested) return "changes";
  return review.complete ? "reviewed" : "unreviewed";
}

function PieceFields({ p, users }: { p?: Piece; users: UserOption[] }) {
  const selected = p ? channelsOf(p) : DEFAULT_CHANNELS;
  return (
    <>
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Título / gancho"><input name="title" required defaultValue={p?.title} className={inputCls} placeholder="SOAP, DAP, BIRP: las letras que nadie pidió en la universidad" /></Field>
      <Field label="Canales" hint="Siempre TikTok, Instagram y Facebook. Si es educativo, agrega LinkedIn.">
        <div className="flex flex-wrap gap-1.5">
          {CHANNEL_ORDER.map((c) => (
            <label key={c} className="cursor-pointer">
              <input type="checkbox" name="channels[]" value={c} defaultChecked={selected.includes(c)} className="peer sr-only" />
              <span className="pill border border-line bg-white text-muted peer-checked:border-emerald/40 peer-checked:bg-mint peer-checked:text-emerald">{CONTENT_CHANNEL[c]}</span>
            </label>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Pilar"><Select name="pillar" defaultValue={p?.pillar ?? "ia_psicoterapia"} options={Object.entries(CONTENT_PILLAR).map(([k, v]) => [k, v.label])} /></Field>
        <Field label="Formato"><Select name="format" defaultValue={p?.format ?? "carrusel"} options={[["carrusel", "Carrusel"], ["reel", "Reel"], ["imagen", "Imagen"], ["video", "Video"], ["historia", "Historia"], ["aporte", "Aporte en grupo"], ["post", "Post"]]} /></Field>
        <Field label="Estado"><Select name="status" defaultValue={p?.status ?? "idea"} options={Object.entries(CONTENT_STATUS).map(([k, v]) => [k, v.label])} /></Field>
        <Field label="Riesgo"><Select name="risk" defaultValue={p?.risk ?? "low"} options={Object.entries(RISK).map(([k, v]) => [k, v.label])} /></Field>
        <Field label="Fecha"><input type="date" name="publishOn" defaultValue={p?.publishOn ?? ""} className={inputCls} /></Field>
      </div>
      <Field label="Responsable"><Select name="ownerId" defaultValue={p?.ownerId} placeholder="Sin asignar" options={users.map((u) => [u.id, u.name])} /></Field>
      <Field label="Copy"><textarea name="copy" rows={4} defaultValue={p?.copy ?? ""} className={inputCls} /></Field>
      <Field label="Fuentes" hint="Una por línea. Obligatorio para cifras: fuente y país."><textarea name="sources" rows={2} defaultValue={p?.sources.join("\n")} className={inputCls} placeholder="APA Practitioner Pulse 2025 (EE. UU.)" /></Field>
      <Field label="Diseño o video" hint="Enlace a Canva, Drive o Figma para que los revisores vean la pieza final."><input name="assetUrl" type="url" defaultValue={p?.assetUrl ?? ""} className={inputCls} /></Field>
      {p && <Field label="URL publicada"><input name="publishedUrl" type="url" defaultValue={p.publishedUrl ?? ""} className={inputCls} /></Field>}
      <fieldset className="rounded-2xl border border-line bg-white p-4">
        <legend className="px-1 text-xs font-bold text-muted">Checklist legal (sección 5 del brief)</legend>
        <p className="mb-2 text-[11px] text-faint">Se necesita completa para aprobar o publicar. Puedes programar antes: la pieza se verá como &quot;Sin revisar&quot;.</p>
        <div className="flex flex-col gap-1.5">
          {LEGAL_CHECKLIST.map((item, i) => (
            <label key={i} className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" name="checks[]" value={String(i)} defaultChecked={p?.legalChecklistOk} className="mt-0.5 h-4 w-4 shrink-0 accent-[#059669]" />
              {item}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export function NewPieceButton({ users, defaultOpen }: { users: UserOption[]; defaultOpen?: boolean }) {
  return (
    <Modal trigger="+ Pieza" title="Nueva pieza de contenido" wide defaultOpen={defaultOpen}>
      <ActionForm action={createPiece}>
        <PieceFields users={users} />
        <div className="flex flex-wrap gap-2">
          <Submit name="intent" value="save">Crear</Submit>
          <Submit name="intent" value="review" variant="secondary">Crear y enviar a revisión</Submit>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function ReviewBadges({ review }: { review?: PieceReview }) {
  if (!review) return null;
  if (review.changesRequested) return <Badge tone="red">Cambios pedidos</Badge>;
  if (review.complete) return <Badge tone="green">Aprobada</Badge>;
  return <Badge tone="amber">Falta: director clínico (o CEO)</Badge>;
}

const STATE_UI = {
  unreviewed: { label: "Sin revisar", tone: "amber", chip: "border-[#E8B84A] bg-[#FFF8E6]" },
  changes: { label: "Cambios pedidos", tone: "red", chip: "border-[#E4A4A4] bg-[#FDF1F1]" },
  reviewed: { label: "Revisada", tone: "green", chip: "" },
} as const;

export function PieceChip({ p, users, full, review }: { p: Piece; users: UserOption[]; full?: boolean; review?: PieceReview }) {
  const state = reviewState(p, review);
  const ui = state ? STATE_UI[state] : null;
  const pendingReview = state === "unreviewed" || state === "changes";
  return (
    <Modal
      title={p.title}
      wide
      triggerClass={cn(
        "w-full rounded-lg border border-line bg-white px-2 py-1 text-left text-[11px] leading-tight hover:border-emerald/40",
        p.status === "published" && "opacity-70",
        pendingReview && ui?.chip,
        full && "rounded-xl px-3 py-2.5 text-[13px]",
      )}
      trigger={
        <span className="flex items-start gap-1.5">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: pillarColor(p.pillar) }} />
          <span className="min-w-0 flex-1">
            <span className={cn("block font-semibold", full ? "" : "line-clamp-2")}>{p.title}</span>
            <span className="block text-faint">
              {channelsOf(p).map((c) => CONTENT_CHANNEL[c]).join(" · ")} · {p.format}
            </span>
            {!full && pendingReview && ui && <span className={cn("mt-0.5 block font-bold", state === "changes" ? "text-danger" : "text-warn")}>{ui.label}</span>}
            {full && (
              <span className="mt-1.5 flex flex-wrap gap-1">
                <Badge tone={CONTENT_STATUS[p.status].tone}>{CONTENT_STATUS[p.status].label}</Badge>
                {ui && <Badge tone={ui.tone}>{ui.label}</Badge>}
                {p.risk !== "low" && <Badge tone={RISK[p.risk].tone}>{RISK[p.risk].label}</Badge>}
                {!p.legalChecklistOk && <Badge tone="gray">Checklist pendiente</Badge>}
              </span>
            )}
          </span>
        </span>
      }
    >
      {state && (
        <div className={cn("mb-4 rounded-2xl px-4 py-3 text-sm", state === "changes" ? "bg-danger-bg text-danger" : state === "reviewed" ? "bg-mint text-emerald" : "bg-[#FFF8E6] text-warn")}>
          <p className="font-bold">{ui!.label}</p>
          {review && !review.complete && !review.changesRequested && <p className="text-xs">Falta la aprobación del director clínico (o del CEO si él no puede).</p>}
          {review?.changesRequested && <p className="text-xs">Revisa los comentarios en Revisión, corrige y guarda: se vuelve a pedir la revisión.</p>}
        </div>
      )}
      <ActionForm action={updatePiece}>
        <PieceFields p={p} users={users} />
        <div className="flex flex-wrap gap-2">
          <Submit name="intent" value="save">Guardar</Submit>
          {!pendingReview && p.status !== "published" && p.status !== "approved" && (
            <Submit name="intent" value="review" variant="secondary">Enviar a revisión</Submit>
          )}
        </div>
      </ActionForm>
      <div className="mt-3 border-t border-line pt-3">
        <DeleteButton kind="piece" id={p.id} what={`la pieza "${p.title}"`} warning="Sale del calendario y se borran sus revisiones. Si venía de una sugerencia, la sugerencia se queda." label="Eliminar pieza" />
      </div>
    </Modal>
  );
}
