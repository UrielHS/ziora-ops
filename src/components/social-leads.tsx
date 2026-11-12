"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, ExternalLink } from "lucide-react";
import { markRepliedAction, postponeAction, setLeadStatusAction } from "@/actions/leads";
import { addContactChannelAction, closeDealAction, recordDmAction, recordOpinionAction, setInfluencerStageAction, setSocialLeadTypeAction } from "@/actions/social-leads";
import { Avatar, Badge, btn, cn, inputCls, Select } from "@/components/ui";
import { CopyButton } from "@/components/ui/copy";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import type { contacts, InfluencerDeal } from "@/db/schema";
import { canMoveStage, DM_DAILY_WARN, dmOpen, socialProfileUrl, usesZiora } from "@/domain/social-shared";
import { fmtDate, todayISO } from "@/lib/format";
import { DEAL_KIND, INFLUENCER_STAGE, SOCIAL_LEAD_TYPE, SOCIAL_PLATFORM, SOCIAL_TIER } from "@/lib/labels";
import { LeadPriorityBadge, LeadStatusBadge } from "./leads";

type Lead = typeof contacts.$inferSelect;
export type DmView = { key: string; step: 1 | 2 | 3; text: string | null } | null;

const STEP_LABEL = { 1: "Primer mensaje", 2: "Seguimiento 1", 3: "Último seguimiento" } as const;

function profileUrl(c: Pick<Lead, "socialPlatform" | "socialHandle">): string | null {
  if (!c.socialHandle) return null;
  return socialProfileUrl(c.socialPlatform === "tiktok" ? "tiktok" : "instagram", c.socialHandle);
}

/** En el mismo clic copia el mensaje y abre el perfil. Si el portapapeles falla, abre el perfil igual y avisa. */
export function OpenProfileButton({ url, text }: { url: string; text: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        className={cn(btn("primary", "sm"), "!py-1.5 !text-xs")}
        onClick={() => {
          // window.open va primero y síncrono: después del await el navegador bloquearía la ventana.
          window.open(url, "_blank", "noopener");
          const fail = () => setNote("Copia el mensaje con el botón Copiar");
          try {
            navigator.clipboard.writeText(text).then(() => setNote("Mensaje copiado"), fail);
          } catch {
            fail();
          }
        }}
      >
        <ExternalLink className="h-3.5 w-3.5" /> Copiar mensaje y abrir perfil
      </button>
      {note && <span role="status" className="text-[11px] text-muted">{note}</span>}
    </span>
  );
}

/** Mensaje del paso: texto, Copiar y los botones de registro. */
function DmBlock({ c, dm, canManage, rows, noLink }: { c: Lead; dm: DmView; canManage: boolean; rows: number; noLink?: boolean }) {
  const url = profileUrl(c);
  // Sin liga el texto tendría un hueco: no se ofrece copiarlo ni registrar el DM.
  const usable = !!dm && !noLink && !!dm.text;
  const open = dmOpen(c.leadStatus);
  return (
    <div className="flex flex-col gap-2">
      {!dm && !open ? (
        <p className="text-sm text-muted">Ya no hay mensajes por DM: el lead ya respondió o salió del seguimiento.</p>
      ) : !dm ? (
        <p className="text-sm text-muted">Ya se mandaron los tres mensajes. Si no responde, márcalo perdido.</p>
      ) : (
        <div className="rounded-2xl border border-line bg-[#FBFAF6] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="label">{STEP_LABEL[dm.step]}</p>
            {dm.text && !noLink && <CopyButton text={dm.text} />}
          </div>
          {noLink ? (
            <p className="mt-1 text-sm text-muted">Abre la ficha para generar su liga</p>
          ) : dm.text ? (
            <textarea readOnly value={dm.text} rows={rows} className="mt-1 w-full resize-none bg-transparent text-sm outline-none" />
          ) : (
            <p className="mt-1 text-sm text-muted">Este mensaje aún no está aprobado por dirección</p>
          )}
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap items-start gap-2">
          {usable && dm.text && url && <OpenProfileButton url={url} text={dm.text} />}
          {usable && (
            <ActionForm action={recordDmAction} className="contents">
              <input type="hidden" name="id" value={c.id} />
              <Submit variant="secondary" className="!py-1.5 !text-xs">Le escribí</Submit>
            </ActionForm>
          )}
          {open && (
            <ActionForm action={markRepliedAction} className="contents">
              <input type="hidden" name="id" value={c.id} />
              <Submit variant="primary" className="!py-1.5 !text-xs">Respondió</Submit>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}

/** Ficha → panel «Redes»: perfil, mensaje que toca, liga de invitación y datos para completar el lead. */
export function SocialPanel({ c, dm, inviteUrl, promoUrl, canManage, inviteClicks, promoClicks }: {
  c: Lead; dm: DmView; inviteUrl: string | null; promoUrl: string | null; canManage: boolean; inviteClicks?: number; promoClicks?: number;
}) {
  const url = profileUrl(c);
  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="font-bold hover:underline">@{c.socialHandle}</a> : <span className="font-bold">@{c.socialHandle}</span>}
        {c.socialPlatform && <Badge tone="gray">{SOCIAL_PLATFORM[c.socialPlatform]}</Badge>}
        {c.socialFollowers && <span className="text-xs text-muted">{c.socialFollowers} seguidores</span>}
        {c.socialTier && <Badge tone="gray">{SOCIAL_TIER[c.socialTier]}</Badge>}
        {c.socialLeadType && <Badge tone="gray">{SOCIAL_LEAD_TYPE[c.socialLeadType]}</Badge>}
      </div>

      <DmBlock c={c} dm={dm} canManage={canManage} rows={5} />

      {inviteUrl && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="label">Liga de invitación</span>
          <span className="break-all text-xs">{inviteUrl}</span>
          <CopyButton text={inviteUrl} />
          {inviteClicks !== undefined && <span className="text-xs text-muted">{inviteClicks} clics</span>}
        </div>
      )}
      {promoUrl && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="label">Liga de promoción</span>
          <span className="break-all text-xs">{promoUrl}</span>
          <CopyButton text={promoUrl} />
          {promoClicks !== undefined && <span className="text-xs text-muted">{promoClicks} clics</span>}
        </div>
      )}

      {canManage && (
        <>
          <ActionForm action={setSocialLeadTypeAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={c.id} />
            <span className="label">Tipo</span>
            <Select name="type" defaultValue={c.socialLeadType ?? "psicologo"} className="w-auto py-1.5 text-xs" options={[["psicologo", "Psicólogo/a"], ["influencer", "Influencer"]]} />
            <Submit variant="ghost" className="!py-1.5 !text-xs">Cambiar tipo</Submit>
          </ActionForm>
          <ActionForm action={addContactChannelAction} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={c.id} />
            <p className="label">Agregar correo o teléfono</p>
            <div className="flex flex-wrap gap-2">
              <input name="email" type="email" placeholder="Correo" className={cn(inputCls, "w-56 py-1.5")} />
              <input name="phone" placeholder="Teléfono" className={cn(inputCls, "w-44 py-1.5")} />
              <Submit variant="secondary" className="!py-1.5 !text-xs">Agregar</Submit>
            </div>
          </ActionForm>
        </>
      )}
    </div>
  );
}

/** Fila de «Mi día» para un lead de redes: perfil, mensaje del paso y las acciones del día. */
export function SocialTodayRow({ c, owner, dm, canManage, noLink }: { c: Lead; owner?: string | null; dm: DmView; canManage: boolean; noLink?: boolean }) {
  const overdue = !!c.nextActionOn && c.nextActionOn < todayISO();
  const url = profileUrl(c);
  return (
    <div className="flex flex-col gap-3 border-b border-[#EFEDE6] px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/leads/${c.id}`} className="text-sm font-bold hover:underline">{c.name}</Link>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:underline">@{c.socialHandle}</a>}
        {c.socialFollowers && <span className="text-xs text-muted">{c.socialFollowers}</span>}
        <LeadPriorityBadge priority={c.priority} />
        <LeadStatusBadge status={c.leadStatus} />
        {c.socialLeadType && <Badge tone="gray">{SOCIAL_LEAD_TYPE[c.socialLeadType]}</Badge>}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted"><Avatar name={owner} size={18} />{owner ?? "Sin dueño"}</span>
      </div>
      {c.nextAction && (
        <p className={cn("flex items-center gap-1 text-xs", overdue ? "font-semibold text-danger" : "text-muted")}>
          <CalendarClock className="h-3.5 w-3.5" />{c.nextAction}{c.nextActionOn && <span>· {fmtDate(c.nextActionOn)}</span>}
        </p>
      )}
      <DmBlock c={c} dm={dm} canManage={canManage} rows={3} noLink={noLink} />
      {canManage && <div className="flex flex-wrap items-center gap-2">
        <ActionForm action={postponeAction} className="contents">
          <input type="hidden" name="id" value={c.id} />
          <span className="text-[11px] text-muted">Posponer</span>
          {[1, 3, 7].map((d) => <Submit key={d} variant="ghost" name="days" value={String(d)} className="!px-2.5 !py-1 !text-xs">{d} {d === 1 ? "día" : "días"}</Submit>)}
        </ActionForm>
        <Modal title={`Marcar perdido a ${c.name}`} triggerClass={cn(btn("ghost", "sm"), "ml-auto text-danger")} trigger={<>Perdido</>}>
          <ActionForm action={setLeadStatusAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="perdido" />
            <input name="lostReason" required autoFocus placeholder="Motivo: no respondió, no le interesa…" className={inputCls} />
            <Submit variant="danger">Marcar perdido</Submit>
          </ActionForm>
        </Modal>
      </div>}
    </div>
  );
}

/** «Hoy llevas N DMs»; al pasar de 30 avisa del riesgo de bloqueo (aviso, no tope). */
export function DmCounter({ sent }: { sent: number }) {
  const over = sent > DM_DAILY_WARN;
  return (
    <div className={cn("rounded-2xl border px-4 py-2.5 text-sm", over ? "border-danger/40 bg-red-50 text-danger" : "border-line bg-white text-muted")}>
      <p className="font-semibold">Hoy llevas {sent} DMs</p>
      {over && <p className="mt-0.5 text-xs">Llevas más de {DM_DAILY_WARN} DMs hoy. Instagram y TikTok bloquean cuentas que mandan muchos mensajes seguidos: mejor sigue mañana.</p>}
    </div>
  );
}

export type InfluencerAppUser = { plan: string; lastActiveAt: Date | null; sessionsTotal: number; notesTotal: number; removedAt: Date | null } | null;

/** Ficha → panel «Influencer»: uso propio de Ziora, opinión, etapas, acuerdo y liga de promoción. Solo para leads de tipo influencer. */
export function InfluencerPanel({ c, deal, appUser, promoUrl, promoClicks, canManage }: {
  c: Lead; deal: Pick<InfluencerDeal, "kind" | "terms" | "notes" | "noUseOverride" | "closedOn"> | null; appUser: InfluencerAppUser;
  promoUrl: string | null; promoClicks?: number; canManage: boolean;
}) {
  const stage = c.influencerStage;
  const uses = usesZiora(appUser);
  const closed = stage === "acuerdo_cerrado";
  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="label">Etapa</span>
        <Badge tone={closed ? "green" : "gray"}>{stage ? INFLUENCER_STAGE[stage] : "Sin etapa"}</Badge>
      </div>

      <div className="text-sm">
        <p className="label">Uso propio de Ziora</p>
        {appUser ? (
          <p className="mt-1">
            Plan {appUser.plan} · {appUser.sessionsTotal} {appUser.sessionsTotal === 1 ? "sesión" : "sesiones"} · {appUser.notesTotal} {appUser.notesTotal === 1 ? "nota" : "notas"}
            {" · "}{appUser.lastActiveAt ? `activo el ${fmtDate(appUser.lastActiveAt)}` : "sin actividad registrada"}
            {appUser.removedAt && <span className="text-danger"> · cuenta dada de baja</span>}
          </p>
        ) : (
          <p className="mt-1 text-muted">Aún no se registra con su invitación</p>
        )}
      </div>

      <div className="text-sm">
        <p className="label">Opinión</p>
        {c.influencerOpinion ? <p className="mt-1 whitespace-pre-wrap">{c.influencerOpinion}</p> : <p className="mt-1 text-muted">Aún sin opinión registrada</p>}
        {canManage && !closed && (
          <ActionForm action={recordOpinionAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="id" value={c.id} />
            <textarea name="opinion" required rows={3} defaultValue={c.influencerOpinion ?? ""} placeholder="Qué le pareció Ziora" className={inputCls} />
            <div><Submit variant="secondary" className="!py-1.5 !text-xs">Guardar opinión</Submit></div>
          </ActionForm>
        )}
      </div>

      {canManage && !closed && (
        <div className="flex flex-wrap items-center gap-2">
          {(["quiere_promover", "no_promueve"] as const).filter((to) => canMoveStage(stage, to)).map((to) => (
            <ActionForm key={to} action={setInfluencerStageAction} className="contents">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="stage" value={to} />
              <Submit variant={to === "quiere_promover" ? "secondary" : "ghost"} className="!py-1.5 !text-xs">{INFLUENCER_STAGE[to]}</Submit>
            </ActionForm>
          ))}
        </div>
      )}

      {canManage && stage === "quiere_promover" && (
        <ActionForm action={closeDealAction} className="flex flex-col gap-2 rounded-2xl border border-line bg-[#FBFAF6] p-3">
          <input type="hidden" name="id" value={c.id} />
          <p className="label">Cerrar acuerdo</p>
          <div className="flex flex-wrap gap-2">
            <Select name="kind" defaultValue="comision" className="w-auto py-1.5 text-xs" options={Object.entries(DEAL_KIND) as [string, string][]} />
            <input name="terms" required placeholder="Monto o porcentaje (p. ej. 20 %)" className={cn(inputCls, "w-56 py-1.5")} />
            <input name="closedOn" type="date" required defaultValue={todayISO()} className={cn(inputCls, "w-40 py-1.5")} />
          </div>
          <input name="notes" placeholder="Notas (opcional)" className={cn(inputCls, "py-1.5")} />
          {!uses && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="overrideNoUse" /> Cerrar aunque todavía no usa Ziora
            </label>
          )}
          <div><Submit variant="primary" className="!py-1.5 !text-xs">Cerrar acuerdo</Submit></div>
        </ActionForm>
      )}

      {closed && deal && (
        <div className="rounded-2xl border border-line bg-[#FBFAF6] p-3 text-sm">
          <p className="label">Acuerdo cerrado</p>
          <p className="mt-1">{DEAL_KIND[deal.kind]} · {deal.terms} · {fmtDate(deal.closedOn, { day: "numeric", month: "short", year: "numeric" })}</p>
          {deal.notes && <p className="mt-1 text-muted">{deal.notes}</p>}
          {deal.noUseOverride && <p className="mt-1 text-xs text-muted">Se cerró sin uso de Ziora.</p>}
        </div>
      )}

      {promoUrl && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="label">Liga de promoción</span>
          <span className="break-all text-xs">{promoUrl}</span>
          <CopyButton text={promoUrl} />
          {promoClicks !== undefined && <span className="text-xs text-muted">{promoClicks} clics</span>}
        </div>
      )}
    </div>
  );
}
