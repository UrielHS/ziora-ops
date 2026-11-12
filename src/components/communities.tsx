"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink, Send } from "lucide-react";
import {
  createCommunityAction, createPostAction, markDeletedByAdminAction, markPublishedAction, prepareCopyAndOpenAction, registerInterestedAction,
  reviewCommunityAction, setBaseMessageStatusAction, setMembershipAction, setPromoPolicyAction, skipPostAction, updatePostTextAction,
} from "@/actions/communities";
import { Badge, btn, cn, Field, inputCls, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { CopyButton } from "@/components/ui/copy";
import type { PublishRow } from "@/domain/community-queue";
import { copyAndOpen } from "@/lib/copy-and-open";
import { fmtDate } from "@/lib/format";
import { COMMUNITY_PLATFORM, COMMUNITY_POST_STATUS, COMMUNITY_PROMO_POLICY, COMMUNITY_STATUS, MEMBERSHIP_STATUS, type Tone } from "@/lib/labels";

// Mismos valores que DISCARD_REASONS del dominio (que no se importa aquí para no meter la base de datos al navegador).
const DISCARD_LABEL: Record<string, string> = {
  para_pacientes: "Es para pacientes", inactiva: "Inactiva", no_es_de_psicologos: "No es de psicólogos", duplicada: "Duplicada", otro: "Otro",
};
const STATUS_TONE: Record<string, Tone> = {
  por_revisar: "amber", aprobada: "blue", activa: "green", pausada: "gray", sin_promocion: "red", descartada: "gray",
};
const POST_TONE: Record<string, Tone> = { planeado: "amber", publicado: "green", omitido: "gray", espera_admin: "blue", borrado_admin: "red" };

export function CommunityStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{COMMUNITY_STATUS[status] ?? status}</Badge>;
}

export function PostStatusBadge({ status }: { status: string }) {
  return <Badge tone={POST_TONE[status] ?? "gray"}>{COMMUNITY_POST_STATUS[status] ?? status}</Badge>;
}

/** Botón con texto visible (CopyButton es solo un icono). */
export function CopyTextButton({ text, label = "Copiar texto" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={btn("ghost", "sm")}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}
    >
      {ok ? <Check className="h-3.5 w-3.5 text-emerald" /> : <Copy className="h-3.5 w-3.5" />} {ok ? "Copiado" : label}
    </button>
  );
}

export function NewCommunityButton() {
  return (
    <Modal trigger="Agregar comunidad" title="Agregar comunidad">
      <ActionForm action={createCommunityAction} resetOnSuccess>
        <Field label="Nombre"><input name="name" required maxLength={200} className={inputCls} /></Field>
        <Field label="Plataforma"><Select name="platform" defaultValue="facebook" options={Object.entries(COMMUNITY_PLATFORM)} /></Field>
        <Field label="Liga del grupo"><input name="url" required type="url" placeholder="https://" className={inputCls} /></Field>
        <Field label="Ciudad o región (opcional)"><input name="cityRegion" className={inputCls} /></Field>
        <Field label="Quién la recomendó (opcional)"><input name="recommendedBy" className={inputCls} /></Field>
        <Field label="Notas (opcional)"><textarea name="notes" rows={2} className={inputCls} /></Field>
        <div><Submit>Agregar</Submit></div>
      </ActionForm>
    </Modal>
  );
}

/** Revisión de una comunidad por revisar: aprobar, marcar como alianza o descartar con motivo. */
export function ReviewForm({ id }: { id: string }) {
  return (
    <ActionForm action={reviewCommunityAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <Submit name="decision" value="aprobada">Aprobar</Submit>
        <Submit name="decision" value="alianza" variant="secondary">Es una alianza</Submit>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select name="reason" placeholder="Motivo del descarte…" options={Object.entries(DISCARD_LABEL)} className="w-56" />
        <Submit name="decision" value="descartada" variant="danger">Descartar</Submit>
      </div>
    </ActionForm>
  );
}

const MEMBERSHIP_TONE: Record<string, Tone> = { unida: "green", solicitud_enviada: "amber", rechazada: "red", nos_sacaron: "red", salio: "gray", por_solicitar: "gray" };

function MembershipForm({ communityId, status, children, variant = "secondary" }: {
  communityId: string; status: string; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <ActionForm action={setMembershipAction} className="contents">
      <input type="hidden" name="communityId" value={communityId} />
      <input type="hidden" name="status" value={status} />
      <Submit variant={variant} className="!py-1.5 !text-xs">{children}</Submit>
    </ActionForm>
  );
}

/** Mi membresía: abrir el grupo y avisar «ya pedí entrar» / «ya estoy dentro». Siempre es para quien tiene la sesión. */
export function MembershipButtons({ communityId, url, status }: { communityId: string; url: string; status: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={MEMBERSHIP_TONE[status ?? "por_solicitar"] ?? "gray"}>{MEMBERSHIP_STATUS[status ?? "por_solicitar"]}</Badge>
      <a href={url} target="_blank" rel="noopener noreferrer" className={btn("ghost", "sm")}><ExternalLink className="h-3.5 w-3.5" /> Abrir grupo</a>
      {status !== "unida" && status !== "solicitud_enviada" && <MembershipForm communityId={communityId} status="solicitud_enviada">Ya pedí entrar</MembershipForm>}
      {status !== "unida" && <MembershipForm communityId={communityId} status="unida" variant="primary">Ya estoy dentro</MembershipForm>}
      {status === "unida" && <MembershipForm communityId={communityId} status="salio" variant="ghost">Salí del grupo</MembershipForm>}
      {status === "solicitud_enviada" && <MembershipForm communityId={communityId} status="rechazada" variant="ghost">Me rechazaron</MembershipForm>}
      {status === "unida" && <MembershipForm communityId={communityId} status="nos_sacaron" variant="ghost">Me sacaron</MembershipForm>}
    </div>
  );
}

/** Política de promoción del grupo; con permiso del admin ofrece el M0 ya con el nombre de quien escribe. */
export function PromoPolicyForm({ communityId, policy, rulesText, adminMessage }: {
  communityId: string; policy: string; rulesText: string | null; adminMessage?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={setPromoPolicyAction} className="flex flex-col gap-2">
        <input type="hidden" name="communityId" value={communityId} />
        <Field label="¿El grupo permite promoción?">
          <Select name="policy" defaultValue={policy} options={Object.entries(COMMUNITY_PROMO_POLICY)} />
        </Field>
        <Field label="Reglas del grupo (opcional)" hint="Pega lo relevante de las reglas del grupo sobre publicidad.">
          <textarea name="rulesText" rows={3} defaultValue={rulesText ?? ""} className={inputCls} />
        </Field>
        <div><Submit variant="secondary" className="!py-1.5 !text-xs">Guardar política</Submit></div>
      </ActionForm>
      {policy === "permiso_admin" && adminMessage && (
        <div className="rounded-2xl border border-line bg-[#FBFAF6] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="label">Mensaje para pedir permiso al admin (M0)</p>
            <CopyButton text={adminMessage} />
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{adminMessage}</p>
        </div>
      )}
    </div>
  );
}

/** «Generar post»: selector de mensaje; deshabilitado con el motivo cuando el grupo no es elegible. */
export function GeneratePost({ communityId, keys, reason }: { communityId: string; keys: string[]; reason: string | null }) {
  return (
    <ActionForm action={createPostAction} className="flex flex-col gap-2">
      <input type="hidden" name="communityId" value={communityId} />
      <div className="flex flex-wrap items-center gap-2">
        <select name="baseMessageKey" disabled={!!reason} className={cn(inputCls.replace("w-full ", ""), "pr-8")}>
          {keys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <Submit disabled={!!reason}><Send className="h-3.5 w-3.5" /> Generar post</Submit>
      </div>
      {reason && <p className="text-xs text-warn">{reason}</p>}
    </ActionForm>
  );
}

export type PostCardData = {
  id: string; code: string; status: string; finalText: string | null; postUrl: string | null; publishedAt: Date | string | null; clicks: number;
};

/** Un post: planeado (texto con liga, copiar, marcar publicado) o publicado (registrar interesado). */
export function PostCard({ post, communityName, canDelete = true, canAct = true }: { post: PostCardData; communityName?: string; canDelete?: boolean; canAct?: boolean }) {
  // Publicar, editar u omitir un post planeado es solo de quien lo generó.
  const open = canAct && (post.status === "planeado" || post.status === "espera_admin");
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {communityName && <span className="text-sm font-bold">{communityName}</span>}
        <PostStatusBadge status={post.status} />
        <span className="text-xs text-faint">código {post.code}</span>
        {post.publishedAt && <span className="text-xs text-muted">publicado {fmtDate(post.publishedAt)}</span>}
        {post.status === "publicado" && <span className="text-xs text-muted">{post.clicks} clic(s)</span>}
      </div>
      {post.finalText && <p className="whitespace-pre-wrap rounded-xl bg-[#FBFAF6] p-3 text-sm">{post.finalText}</p>}
      {open && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {post.finalText && <CopyTextButton text={post.finalText} />}
            <Modal trigger="Editar texto" title="Editar texto" triggerClass={btn("ghost", "sm")}>
              <ActionForm action={updatePostTextAction}>
                <input type="hidden" name="postId" value={post.id} />
                <Field label="Texto" hint="Debe conservar la liga corta: sin ella no se puede atribuir.">
                  <textarea name="text" rows={8} required defaultValue={post.finalText ?? ""} className={inputCls} />
                </Field>
                <div><Submit>Guardar texto</Submit></div>
              </ActionForm>
            </Modal>
          </div>
          <ActionForm action={markPublishedAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="postId" value={post.id} />
            <Field label="URL del post (opcional)" className="min-w-56 flex-1">
              <input name="postUrl" type="url" placeholder="https://" className={inputCls} />
            </Field>
            <Submit>Marcar publicado</Submit>
          </ActionForm>
          <ActionForm action={skipPostAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="postId" value={post.id} />
            <Field label="Omitir este post" className="min-w-56 flex-1">
              <input name="reason" required placeholder="Motivo (ej. el admin no respondió)" className={inputCls} />
            </Field>
            <Submit variant="ghost">Omitir</Submit>
          </ActionForm>
        </div>
      )}
      {post.status === "publicado" && (
        <div className="flex flex-wrap items-center gap-2">
          {post.postUrl && <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className={btn("ghost", "sm")}><ExternalLink className="h-3.5 w-3.5" /> Abrir post</a>}
          <Modal trigger="Registrar interesado" title={`Registrar interesado${communityName ? ` · ${communityName}` : ""}`} triggerClass={btn("secondary", "sm")}>
            <InterestedForm postId={post.id} />
          </Modal>
          {canDelete && (
            <ActionForm action={markDeletedByAdminAction} className="contents">
              <input type="hidden" name="postId" value={post.id} />
              <Submit variant="danger" className="!py-1.5 !text-xs">El admin lo borró</Submit>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}

/** Registro de una persona interesada que respondió a un post. Pide al menos correo, teléfono o perfil. */
export function InterestedForm({ postId }: { postId: string }) {
  return (
    <ActionForm action={registerInterestedAction} resetOnSuccess>
      <input type="hidden" name="postId" value={postId} />
      <Field label="Nombre"><input name="name" required maxLength={200} className={inputCls} /></Field>
      <p className="-mb-2 text-xs text-muted">Basta con uno de los tres: correo, teléfono o perfil.</p>
      <Field label="Correo"><input name="email" type="email" className={inputCls} /></Field>
      <Field label="Teléfono"><input name="phone" inputMode="tel" className={inputCls} /></Field>
      <Field label="Perfil o enlace"><input name="profileUrl" className={inputCls} placeholder="https://" /></Field>
      <Field label="Es"><Select name="kind" defaultValue="psicologo" options={[["psicologo", "Psicóloga/o"], ["clinica", "Clínica"], ["asociacion", "Asociación"]]} /></Field>
      <Field label="Nota (opcional)"><textarea name="note" rows={2} className={inputCls} /></Field>
      <div><Submit>Registrar interesado</Submit></div>
    </ActionForm>
  );
}

/** En la ficha del lead: de qué comunidad y post vino, con qué UTM y quién lo registró. */
export function AttributionPanel({ communityId, communityName, postCode, utm, registeredBy, registeredAt }: {
  communityId: string | null; communityName: string | null; postCode: string | null; utm: Record<string, string>;
  registeredBy: string | null; registeredAt: Date | string | null;
}) {
  const utmEntries = Object.entries(utm).filter(([, v]) => v);
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 pb-5 text-sm sm:grid-cols-2">
      <div>
        <dt className="label">Comunidad</dt>
        <dd>{communityId && communityName ? <Link href={`/communities/${communityId}`} className="font-semibold text-teal hover:underline">{communityName}</Link> : "—"}</dd>
      </div>
      <div><dt className="label">Código del post</dt><dd>{postCode ?? "—"}</dd></div>
      <div><dt className="label">Registró</dt><dd>{registeredBy ?? "—"}</dd></div>
      <div><dt className="label">Cuándo</dt><dd>{registeredAt ? fmtDate(registeredAt, { day: "numeric", month: "short", year: "numeric" }) : "—"}</dd></div>
      {utmEntries.length > 0 && (
        <div className="sm:col-span-2">
          <dt className="label">UTM</dt>
          <dd className="flex flex-wrap gap-1.5">
            {utmEntries.map(([k, v]) => <Badge key={k} tone="gray">{k.replace("utm_", "")}: {v}</Badge>)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Botón «Copiar y abrir grupo»: crea el post, copia el texto con la liga corta y abre el grupo en pestaña nueva. */
export function CopyAndOpenButton({ communityId, messageKey, onDone, label = "Copiar y abrir grupo" }: {
  communityId: string; messageKey: string; onDone?: (postId: string, text: string) => void; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        className={btn("primary")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          // Todo lo que exige el gesto del clic (pestaña y portapapeles) arranca aquí, antes de esperar al servidor (iOS/Safari).
          const r = await copyAndOpen(() => prepareCopyAndOpenAction(communityId, messageKey), {
            openBlank: () => window.open("about:blank", "_blank"),
            writeFromPromise: typeof window.ClipboardItem !== "undefined"
              ? (text) => navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })])
              : undefined,
            writeText: (t) => navigator.clipboard.writeText(t),
          });
          setBusy(false);
          if (r.ok) onDone?.(r.postId, r.text); else setError(r.error);
        }}
      >
        <Copy className="h-4 w-4" /> {busy ? "Preparando…" : label}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function PublishItem({ row, messageKeys }: { row: PublishRow; messageKeys: string[] }) {
  const [key, setKey] = useState(row.defaultKey);
  const [copied, setCopied] = useState<{ postId: string; text: string } | null>(null);
  const post = copied ?? (row.planned ? { postId: row.planned.postId, text: row.planned.text } : null);
  const c = row.community;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/communities/${c.id}`} className="text-sm font-bold hover:underline">{c.name}</Link>
        <Badge tone="gray">{COMMUNITY_PLATFORM[c.platform] ?? c.platform}</Badge>
        {c.priority && <Badge tone={c.priority === "A" ? "green" : "gray"}>Prioridad {c.priority}</Badge>}
        <span className="text-xs text-faint">{row.lastPublishedAt ? `Último post: ${fmtDate(row.lastPublishedAt)}` : "Sin posts todavía"}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mensaje">
          <select value={key} onChange={(e) => setKey(e.target.value)} className={cn(inputCls.replace("w-full ", ""), "pr-8")} aria-label="Mensaje">
            {messageKeys.map((k) => <option key={k} value={k}>{k}{(row.usage[k] ?? 0) > 0 ? ` · usado ${row.usage[k]}` : ""}</option>)}
          </select>
        </Field>
        <CopyAndOpenButton communityId={c.id} messageKey={key} onDone={(postId, text) => setCopied({ postId, text })} />
      </div>
      {post && (
        <div className="flex flex-col gap-3 rounded-xl bg-mint/50 p-3">
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-muted">Ver el texto copiado</summary>
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-white p-3 text-sm">{post.text}</p>
          </details>
          {/* Camino manual siempre disponible, por si el navegador bloquea el portapapeles o la pestaña. */}
          <div className="flex flex-wrap items-center gap-2">
            <CopyTextButton text={post.text} />
            <a href={c.url} target="_blank" rel="noopener noreferrer" className={btn("ghost", "sm")}><ExternalLink className="h-3.5 w-3.5" /> Abrir grupo</a>
          </div>
          <ActionForm action={markPublishedAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="postId" value={post.postId} />
            <Field label="¿Ya publicaste? Pega la URL del post (opcional)" className="min-w-56 flex-1">
              <input name="postUrl" type="url" placeholder="https://" className={inputCls} />
            </Field>
            <Submit>Marcar publicado</Submit>
          </ActionForm>
        </div>
      )}
    </li>
  );
}

/** Bloque «Publicar» de /communities/publicar. */
export function PublishQueue({ rows, messageKeys, remaining, publishedThisWeek, quota }: {
  rows: PublishRow[]; messageKeys: string[]; remaining: number; publishedThisWeek: number; quota: number;
}) {
  if (!rows.length) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
        {remaining === 0 && publishedThisWeek >= quota
          ? `Ya completaste tus ${quota} posts de los últimos 7 días.`
          : "Ahora no hay grupos listos para publicar. Únete a más grupos o registra su política de promoción."}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => <PublishItem key={r.community.id} row={r} messageKeys={messageKeys} />)}
    </ul>
  );
}

/** Mensajes base M0–M6: estado, texto y, solo para quien aprueba, cambiar el estado. */
export function BaseMessageRow({ m, canApprove }: { m: { key: string; angle: string | null; body: string; status: string; isPost: boolean }; canApprove: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{m.key}</span>
        {m.angle && <span className="text-sm text-muted">{m.angle}</span>}
        <Badge tone={m.status === "aprobado" ? "green" : m.status === "retirado" ? "red" : "amber"}>{m.status === "aprobado" ? "Aprobado" : m.status === "retirado" ? "Retirado" : "Borrador"}</Badge>
        {!m.isPost && <Badge tone="gray">No es post</Badge>}
        <span className="ml-auto"><CopyButton text={m.body} /></span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted">{m.body}</p>
      {canApprove && (
        <ActionForm action={setBaseMessageStatusAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="key" value={m.key} />
          {m.status !== "aprobado" && <Submit name="status" value="aprobado" className="!py-1.5 !text-xs">Aprobar</Submit>}
          {m.status === "aprobado" && <Submit name="status" value="retirado" variant="danger" className="!py-1.5 !text-xs">Retirar</Submit>}
          {m.status === "retirado" && <Submit name="status" value="borrador" variant="ghost" className="!py-1.5 !text-xs">Volver a borrador</Submit>}
        </ActionForm>
      )}
    </div>
  );
}
