import { asc } from "drizzle-orm";
import { CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";
import { setMemberRoles } from "@/actions/team";
import { createEpic } from "@/actions/tasks";
import { Avatar, Badge, btn, Card, Field, inputCls, PageHeader, PanelHeader } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { CopyButton } from "@/components/ui/copy";
import { db } from "@/db";
import { listEpics } from "@/db/queries";
import { memberRoles } from "@/db/schema";
import { users } from "@/db/shared";
import { OPS_ROLE } from "@/lib/labels";
import { ALL_ROLES, can } from "@/lib/permissions";
import { requireAccess } from "@/lib/session";
import { DeleteButton } from "@/components/ui/delete-button";

import { SellerProfileForm } from "@/components/sellers";
import { getSellerProfile, listSellerProfiles, referralCodeFrom } from "@/domain/sellers";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await requireAccess();
  const [team, epics, roleRows, myProfile, allProfiles] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    listEpics(),
    db.select().from(memberRoles),
    getSellerProfile(db, access.user.id),
    listSellerProfiles(db),
  ]);
  const rolesOf = (userId: string) => roleRows.filter((r) => r.userId === userId).map((r) => r.role);
  const canManageTeam = can(access, "team.manage");
  const app = process.env.APP_URL ?? "http://localhost:3001";
  const eventOps = process.env.EVENT_OPS_URL ?? "https://event-ops-845770051786.us-central1.run.app";
  const integrations = [
    { name: "Base de datos compartida", ok: true, detail: "Cloud SQL event-ops-db · schemas public (Event Ops) y ops (Ziora Ops)" },
    { name: "Login con Google", ok: !!process.env.AUTH_GOOGLE_ID, detail: "Mismo cliente OAuth que Event Ops" },
    { name: "Resend (correo)", ok: !!process.env.RESEND_API_KEY, detail: process.env.MAIL_FROM ?? "Falta MAIL_FROM", hook: `${app}/api/webhooks/resend` },
    { name: "GitHub", ok: !!process.env.GITHUB_TOKEN, detail: process.env.GITHUB_REPOS || "Falta GITHUB_REPOS", hook: `${app}/api/webhooks/github` },
    {
      name: "Demos desde el calendario del CEO",
      ok: !!(process.env.GOOGLE_CALENDAR_SUBJECT && process.env.GOOGLE_INGEST_SA),
      detail: process.env.GOOGLE_CALENDAR_SUBJECT
        ? `${process.env.GOOGLE_CALENDAR_SUBJECT} · eventos con "${process.env.DEMO_EVENT_MATCH || "Demo"}" · cada 10 min`
        : "Falta GOOGLE_CALENDAR_SUBJECT y la delegación de dominio en Workspace",
      hook: `${app}/api/jobs/sync-demos`,
    },
    { name: "Webhook de demos (otras fuentes)", ok: !!process.env.DEMO_WEBHOOK_SECRET, detail: "Opcional; firma HMAC", hook: `${app}/api/webhooks/demo` },
    { name: "Reporte de bugs desde la app", ok: !!process.env.BUG_INTAKE_KEY, detail: "Authorization: Bearer BUG_INTAKE_KEY", hook: `${app}/api/bugs` },
    {
      name: "Usuarios de Ziora Copilot (Firebase)",
      ok: !!(process.env.ZIORA_APP_SNAPSHOT_URL && process.env.ZIORA_APP_BRIDGE_SECRET),
      detail: process.env.ZIORA_APP_SNAPSHOT_URL ? "opsSnapshot cada hora · solo conteos de pacientes" : "Falta desplegar opsSnapshot (docs/PUENTE-ZIORA-APP.md)",
      hook: `${app}/api/jobs/sync-ziora-users`,
    },
    { name: "Redes y anuncios (Meta)", ok: !!process.env.SOCIAL_TOKEN_KEY, detail: process.env.SOCIAL_TOKEN_KEY ? "Tokens por cuenta en Redes sociales · cada mañana" : "Falta SOCIAL_TOKEN_KEY (docs/REDES-Y-ANUNCIOS.md)", hook: `${app}/api/jobs/sync-social` },
    { name: "Ayuda y sugerencias de la app", ok: !!process.env.ZIORA_APP_BRIDGE_SECRET, detail: "Trigger opsHelpRequest → tickets; firma X-Ops-Signature", hook: `${app}/api/webhooks/ziora-help` },
    {
      name: "Cadencia de leads",
      ok: !!(process.env.JOB_SECRET && process.env.RESEND_API_KEY),
      detail: process.env.JOB_SECRET ? "Cloud Scheduler cada hora de 8 a 20 (CDMX) · correos por Resend, WhatsApp queda en Hoy" : "Falta JOB_SECRET (docs/RUNBOOK-CRM-LEADS.md §7)",
      hook: `${app}/api/jobs/run-sequences`,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Ajustes" title="Configuración" subtitle="Guía completa de conexión en docs/SETUP-CONEXION.md" />
      <Card>
        <PanelHeader title="Mi perfil de vendedor" subtitle="Tus ligas personales. Aparecen en la ficha de cada lead como «Mis ligas» para copiarlas en un clic." />
        <SellerProfileForm profile={myProfile} />
        {canManageTeam && allProfiles.length > 0 && (
          <div className="border-t border-line px-5 py-4">
            <p className="label mb-2">Perfiles del equipo</p>
            <ul className="flex flex-col gap-1 text-sm">
              {allProfiles.map((p) => {
                const who = team.find((u) => u.id === p.userId)?.name ?? "—";
                return (
                  <li key={p.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{who}</span>
                    <span className="text-muted">referido: {referralCodeFrom(p.referralUrl) ?? "sin liga"}</span>
                    <span className="text-muted">calendario: {p.bookingUrl ? "sí" : "no"}</span>
                    <span className="text-muted">código: {p.discountCode ?? "—"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <PanelHeader title="Integraciones" />
        <div className="mt-2">
          {integrations.map((i) => (
            <div key={i.name} className="flex flex-col gap-2 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0 md:flex-row md:items-center">
              {i.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald" /> : <CircleDashed className="h-5 w-5 shrink-0 text-faint" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{i.name}</span>
                <span className="block truncate text-xs text-muted">{i.detail}</span>
              </span>
              {i.hook && <span className="flex items-center gap-2"><code className="max-w-xs truncate rounded-lg bg-[#F3F1EA] px-2 py-1 text-[11px]">{i.hook}</code><CopyButton text={i.hook} /></span>}
              <Badge tone={i.ok ? "green" : "gray"}>{i.ok ? "Conectado" : "Pendiente"}</Badge>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <PanelHeader title="Equipo" subtitle="Las cuentas se dan de alta en Event Ops (Settings → Users). Los roles de Ziora Ops se asignan aquí." action={<a href={`${eventOps}/settings`} target="_blank" className={btn("ghost", "sm")}>Event Ops <ExternalLink className="h-3 w-3" /></a>} />
          <div className="mt-2">
            {team.map((u) => (
              <div key={u.id} className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-2.5 last:border-b-0">
                <Avatar name={u.name} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{u.name}</span>
                  <span className="block truncate text-xs text-muted">{u.email}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {!u.active && <Badge tone="gray">inactivo</Badge>}
                    {rolesOf(u.id).map((r) => <Badge key={r} tone={OPS_ROLE[r].tone}>{OPS_ROLE[r].label}</Badge>)}
                    {u.active && rolesOf(u.id).length === 0 && <span className="text-[11px] text-faint">Sin rol</span>}
                  </span>
                </span>
                {canManageTeam && (
                  <Modal trigger="Roles" title={`Roles de ${u.name}`} triggerClass={btn("ghost", "sm")}>
                    <ActionForm action={setMemberRoles}>
                      <input type="hidden" name="userId" value={u.id} />
                      <div className="flex flex-col gap-2">
                        {ALL_ROLES.map((r) => (
                          <label key={r} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="roles[]" value={r} defaultChecked={rolesOf(u.id).includes(r)} className="h-4 w-4 accent-[#059669]" />
                            {OPS_ROLE[r].label}
                          </label>
                        ))}
                      </div>
                      <Submit>Guardar</Submit>
                    </ActionForm>
                  </Modal>
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <PanelHeader
            title="Épicas"
            subtitle="Agrupan tareas en el tablero"
            action={
              <Modal trigger="+ Épica" title="Nueva épica" triggerClass={btn("ghost", "sm")}>
                <ActionForm action={createEpic}>
                  <div className="grid grid-cols-[1fr_2fr] gap-3">
                    <Field label="Clave"><input name="key" required maxLength={8} className={inputCls} placeholder="LEGAL" /></Field>
                    <Field label="Nombre"><input name="name" required className={inputCls} placeholder="Revisión legal" /></Field>
                  </div>
                  <Field label="Color"><input type="color" name="color" defaultValue="#4E6B5C" className="h-10 w-20 rounded-lg border border-line" /></Field>
                  <Submit>Crear</Submit>
                </ActionForm>
              </Modal>
            }
          />
          <div className="mt-2">
            {epics.map((e) => (
              <div key={e.id} className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-2.5 last:border-b-0">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: e.color }}>{e.key}</span>
                <span className="flex-1 text-sm">{e.name}</span>
                {canManageTeam && <DeleteButton kind="epic" id={e.id} what={`la épica ${e.key}`} warning="Sus tareas se quedan, sin épica." label="" />}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
