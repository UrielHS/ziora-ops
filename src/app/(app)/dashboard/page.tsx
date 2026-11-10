import Link from "next/link";
import { and, asc, count, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { Bug, Check, CheckSquare, CircleDashed, GitPullRequest, Mail, OctagonAlert, Users, Video, X } from "lucide-react";
import { Avatar, Badge, Card, cn, Kpi, PanelHeader, Progress, ViewAll } from "@/components/ui";
import { db } from "@/db";
import { activeSprint, listEpics, listUsers } from "@/db/queries";
import { goalsWithValues, gtmDay, gtmPhase } from "@/db/goals";
import { gtmWeekLabel } from "@/lib/gtm";
import { bugs, campaigns, contactConsents, demoRequests, emailTemplates, pullRequests, tasks, contacts, contactTags } from "@/db/schema";
import { resolveRecipients } from "@/domain/campaigns";
import { renderTemplate } from "@/domain/template";
import { cap, fmtDate, fmtDateTime, relative, todayISO } from "@/lib/format";
import { BUG_SEVERITY, BUG_STATUS, CAMPAIGN_STATUS, CITY, DEMO_STAGE, PRIORITY, TASK_STATUS } from "@/lib/labels";
import { MyDay } from "@/components/my-day";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";
const OPEN_BUG = ["new", "triaged", "in_progress"] as const;
type View = "all" | "producto" | "gtm" | "ventas";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ vista?: string; sinPermiso?: string }> }) {
  const sp = await searchParams;
  const view: View = (["producto", "gtm", "ventas"] as const).includes(sp.vista as "gtm") ? (sp.vista as View) : "all";
  const show = (...v: View[]) => view === "all" || v.includes(view);

  const access = await requireAccess();
  const { user } = access;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
  const in7 = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const sprint = await activeSprint();

  const [
    users, epics, blockers, critical, [demosWeek], [demosPrev], [openTasks], [dueSoon], [openBugs], [critCount], [openPrs], [waitingPrs],
    [psych], [optIn], demos, sprintTasks, prs, bugRows, goals, [nextCampaign],
  ] = await Promise.all([
    listUsers(), listEpics(),
    db.select().from(tasks).where(and(eq(tasks.blocker, true), ne(tasks.status, "done"))).orderBy(asc(tasks.number)),
    db.select().from(bugs).where(and(eq(bugs.severity, "critical"), inArray(bugs.status, [...OPEN_BUG]))),
    db.select({ n: count() }).from(demoRequests).where(gte(demoRequests.createdAt, weekAgo)),
    db.select({ n: count() }).from(demoRequests).where(and(gte(demoRequests.createdAt, twoWeeksAgo), lt(demoRequests.createdAt, weekAgo))),
    db.select({ n: count() }).from(tasks).where(and(ne(tasks.status, "done"), ne(tasks.status, "backlog"))),
    db.select({ n: count() }).from(tasks).where(and(ne(tasks.status, "done"), sql`${tasks.dueOn} <= ${in7}`)),
    db.select({ n: count() }).from(bugs).where(inArray(bugs.status, [...OPEN_BUG])),
    db.select({ n: count() }).from(bugs).where(and(eq(bugs.severity, "critical"), inArray(bugs.status, [...OPEN_BUG]))),
    db.select({ n: count() }).from(pullRequests).where(eq(pullRequests.state, "open")),
    db.select({ n: count() }).from(pullRequests).where(and(eq(pullRequests.state, "open"), eq(pullRequests.draft, false), or(ne(pullRequests.reviewState, "approved"), sql`${pullRequests.reviewState} is null`))),
    db.select({ n: count() }).from(contactTags).where(eq(contactTags.tag, "psychologist")),
    db.select({ n: count() }).from(contactConsents).where(eq(contactConsents.optIn, true)),
    db.select({ d: demoRequests, city: contacts.city }).from(demoRequests).leftJoin(contacts, eq(contacts.id, demoRequests.contactId)).orderBy(asc(demoRequests.scheduledAt), desc(demoRequests.createdAt)),
    sprint ? db.select().from(tasks).where(eq(tasks.sprintId, sprint.id)).orderBy(asc(tasks.status), asc(tasks.number)) : Promise.resolve([]),
    db.select().from(pullRequests).where(eq(pullRequests.state, "open")).orderBy(desc(pullRequests.ghUpdatedAt)).limit(4),
    db.select().from(bugs).where(inArray(bugs.status, [...OPEN_BUG])).orderBy(asc(bugs.severity), desc(bugs.createdAt)).limit(5),
    goalsWithValues(),
    db.select({ c: campaigns, t: emailTemplates }).from(campaigns).innerJoin(emailTemplates, eq(emailTemplates.id, campaigns.templateId))
      .where(inArray(campaigns.status, ["draft", "scheduled"])).orderBy(asc(campaigns.scheduledAt), desc(campaigns.createdAt)).limit(1),
  ]);
  const recipients = nextCampaign ? (await resolveRecipients(db, nextCampaign.c.id)).length : 0;
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name;
  const day = gtmDay();
  const phase = gtmPhase(day);
  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: "America/Mexico_City" }).format(now));
  const greet = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const delta = demosWeek.n - demosPrev.n;
  const sprintDone = sprintTasks.filter((t) => t.status === "done").length;
  const today = todayISO();

  const pipelineCols = ["requested", "scheduled", "done", "trial", "paid"] as const;

  return (
    <div className="flex flex-col gap-5">
      {/* HERO */}
      <section className="hero-gradient relative overflow-hidden rounded-3xl px-6 py-7 md:px-8">
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold text-[#4F6F5F]">
              {cap(fmtDate(now, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}
              {gtmWeekLabel(now) && <> · {gtmWeekLabel(now)}</>}
            </p>
            <h1 className="mt-2 text-[32px] font-extrabold leading-tight tracking-tight text-ink">{greet}, {user.name.split(" ")[0]}</h1>
            <p className="mt-1 text-sm text-[#4F6F5F]">Operación, ventas y producto de Ziora en un solo lugar.</p>
          </div>
          <form className="flex items-center gap-2">
            <select name="vista" defaultValue={view === "all" ? "" : view} className="rounded-full border border-white/80 bg-white/90 py-2 pl-4 pr-9 text-sm font-semibold text-teal outline-none">
              <option value="">Vista: Toda la operación</option>
              <option value="producto">Vista: Producto</option>
              <option value="gtm">Vista: GTM</option>
              <option value="ventas">Vista: Ventas</option>
            </select>
            <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white">Ver</button>
          </form>
        </div>
      </section>

      {sp.sinPermiso === "1" && (
        <p className="rounded-2xl border border-warn/30 bg-warn-bg px-4 py-2.5 text-sm text-warn">Esa sección no está disponible para tu rol. Si la necesitas, pide acceso a Chris o a Pau.</p>
      )}
      <MyDay access={access} />

      {/* BLOQUEOS */}
      {(blockers.length > 0 || critical.length > 0) && (
        <Card className="border-l-4 border-l-danger">
          <p className="label px-5 pt-4 text-danger">Bloqueos activos · {blockers.length + critical.length}</p>
          <div className="mt-1">
            {blockers.map((t) => (
              <Link key={t.id} href="/tasks?sprint=all" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0 hover:bg-[#FBFAF6]">
                <OctagonAlert className="h-4 w-4 text-danger" />
                <span className="text-sm font-semibold">{t.title}</span>
                <Badge tone="red">Bloqueante</Badge>
                {t.description && <span className="text-xs text-muted">{t.description}</span>}
                <span className="ml-auto flex items-center gap-2 text-xs text-muted">{nameOf(t.assigneeId)}<Avatar name={nameOf(t.assigneeId)} size={22} /></span>
              </Link>
            ))}
            {critical.map((b) => (
              <Link key={b.id} href="/bugs" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0 hover:bg-[#FBFAF6]">
                <Bug className="h-4 w-4 text-danger" />
                <span className="text-sm font-semibold">BUG-{b.number}: {b.title}</span>
                <Badge tone="red">Bug crítico</Badge>
                <span className="text-xs text-muted">{b.area}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi highlight href="/demos" label="Demos esta semana" value={demosWeek.n} note={`${delta >= 0 ? "+" : ""}${delta} vs la anterior`} icon={Video} />
        <Kpi href="/tasks" label="Tareas abiertas" value={openTasks.n} note={`${dueSoon.n} vencen en 7 días`} icon={CheckSquare} />
        <Kpi href="/bugs" label="Bugs abiertos" value={openBugs.n} note={`${critCount.n} crítico${critCount.n === 1 ? "" : "s"}`} icon={Bug} />
        <Kpi href="/pull-requests" label="PRs abiertos" value={openPrs.n} note={`${waitingPrs.n} esperan revisión`} icon={GitPullRequest} />
        <Kpi href="/contacts?tag=psychologist" label="Psicólogos en base" value={psych.n} note="En Contactos" icon={Users} />
        <Kpi href="/contacts?consent=yes" label="Con permiso de correo" value={optIn.n} note="Opt-in vigente" icon={Mail} />
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          {/* PIPELINE */}
          {show("ventas", "gtm") && (
            <Card>
              <PanelHeader title="Pipeline de demos" subtitle="Solicitudes desde ziora-copilot.com/demo y registro manual" action={<ViewAll href="/demos" />} />
              <div className="mt-4 grid grid-cols-2 gap-2 px-5 pb-5 sm:grid-cols-5">
                {pipelineCols.map((st) => {
                  const items = demos.filter((r) => r.d.stage === st);
                  return (
                    <div key={st} className="min-w-0 rounded-2xl bg-[#F3F1EA] p-2">
                      <div className="flex items-center justify-between px-1.5 pb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{DEMO_STAGE[st].label}</span>
                        <span className="rounded-full bg-white px-2 text-[11px] font-semibold text-faint">{items.length}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {items.slice(0, 3).map(({ d, city }) => {
                          const tday = d.trialStartedAt ? Math.min(14, Math.ceil((now.getTime() - d.trialStartedAt.getTime()) / 86400000)) : 0;
                          return (
                            <Link key={d.id} href="/demos" className="rounded-xl border border-line bg-white p-2.5 hover:border-emerald/40">
                              <p className="truncate text-[13px] font-semibold">{d.fullName}</p>
                              <p className="truncate text-[11px] text-muted">{city ? CITY[city] : "—"}{d.patientsPerWeek ? ` · ${d.patientsPerWeek} pac/sem` : ""}</p>
                              {st === "scheduled" && d.scheduledAt && <p className="mt-1 text-[11px] font-semibold text-emerald">{fmtDateTime(d.scheduledAt)}</p>}
                              {st === "trial" && (
                                <div className="mt-1.5 flex items-center gap-1.5"><Progress value={tday} max={14} /><span className="text-[10px] text-muted">{tday}/14</span></div>
                              )}
                            </Link>
                          );
                        })}
                        {items.length > 3 && <Link href="/demos" className="px-1.5 text-[11px] font-semibold text-muted">+{items.length - 3} más</Link>}
                        {items.length === 0 && <p className="px-1.5 py-3 text-[11px] text-faint">Vacío</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* SPRINT */}
          {show("producto", "gtm") && (
            <Card>
              <PanelHeader
                title={sprint ? `Sprint actual · ${sprint.name}` : "Sin sprint activo"}
                subtitle={sprint ? `${fmtDate(sprint.startsOn)} – ${fmtDate(sprint.endsOn)}${sprint.goal ? ` · ${sprint.goal}` : ""}` : "Activa uno en Tareas"}
                action={<ViewAll href="/tasks" label="Tablero" />}
              />
              <div className="mt-3">
                {sprintTasks.filter((t) => t.status !== "done").slice(0, 7).map((t) => {
                  const epic = epics.find((e) => e.id === t.epicId);
                  const overdue = t.dueOn && t.dueOn < today;
                  return (
                    <div key={t.id} className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-2.5">
                      <span className="w-[62px] shrink-0 text-xs font-semibold text-faint">ZOP-{t.number}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                      {epic && <span className="hidden rounded-full px-2 py-0.5 text-[10px] font-bold text-white sm:inline" style={{ background: epic.color }}>{epic.key}</span>}
                      <Badge tone={PRIORITY[t.priority].tone} className="hidden md:inline-flex">{PRIORITY[t.priority].label}</Badge>
                      <Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
                      <span className={cn("hidden w-14 text-right text-[11px] sm:block", overdue ? "font-semibold text-danger" : "text-faint")}>{t.dueOn ? fmtDate(t.dueOn) : ""}</span>
                      <Avatar name={nameOf(t.assigneeId)} size={24} />
                    </div>
                  );
                })}
                <div className="flex items-center gap-3 px-5 py-4">
                  <Progress value={sprintDone} max={sprintTasks.length} />
                  <span className="whitespace-nowrap text-xs font-semibold text-muted">{sprintDone} de {sprintTasks.length} tareas</span>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {show("producto") && (
            <Card>
              <PanelHeader title="Pull requests" action={<ViewAll href="/pull-requests" />} />
              <div className="mt-2">
                {prs.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Sin PRs abiertos.</p>}
                {prs.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" className="flex items-center gap-2.5 border-b border-[#EFEDE6] px-5 py-2.5 last:border-b-0 hover:bg-[#FBFAF6]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">#{p.number} {p.title}</span>
                      <span className="block truncate text-[11px] text-faint">{p.repo} · {p.author} · {relative(p.ghUpdatedAt)}</span>
                    </span>
                    {p.draft ? <Badge>Draft</Badge> : <Badge tone={p.reviewState === "approved" ? "green" : p.reviewState === "changes_requested" ? "red" : "amber"}>{p.reviewState === "approved" ? "Aprobado" : p.reviewState === "changes_requested" ? "Cambios" : "En revisión"}</Badge>}
                    {p.checksState === "success" ? <Check className="h-4 w-4 text-emerald" /> : p.checksState === "failure" ? <X className="h-4 w-4 text-danger" /> : <CircleDashed className="h-4 w-4 text-faint" />}
                  </a>
                ))}
              </div>
            </Card>
          )}

          {show("producto") && (
            <Card>
              <PanelHeader title="QA y bugs" action={<ViewAll href="/bugs" />} />
              <div className="mt-2">
                {bugRows.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Sin bugs abiertos.</p>}
                {bugRows.map((b) => (
                  <Link key={b.id} href="/bugs" className="flex items-center gap-2.5 border-b border-[#EFEDE6] px-5 py-2.5 last:border-b-0 hover:bg-[#FBFAF6]">
                    <Badge tone={BUG_SEVERITY[b.severity].tone} className="w-14 justify-center">{BUG_SEVERITY[b.severity].label}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{b.title}</span>
                      <span className="block truncate text-[11px] text-faint">BUG-{b.number} · {b.area ?? "Sin área"}</span>
                    </span>
                    <Badge tone={BUG_STATUS[b.status].tone}>{BUG_STATUS[b.status].label}</Badge>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {show("gtm", "ventas") && (
            <Card>
              <PanelHeader title="Próxima campaña" action={<ViewAll href="/campaigns" />} />
              {nextCampaign ? (
                <Link href={`/campaigns/${nextCampaign.c.id}`} className="m-5 mt-3 block overflow-hidden rounded-2xl border border-line hover:border-emerald/40">
                  <div className="pointer-events-none h-36 overflow-hidden bg-[#F3F1EA]">
                    <iframe
                      title="Vista previa"
                      sandbox=""
                      srcDoc={renderTemplate(nextCampaign.t.html, { nombre: "Andrea", evento: "Demo Night", evento_fecha: "Próximamente", baja: "#" })}
                      className="h-[540px] w-[200%] origin-top-left scale-50 border-0"
                    />
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-bold">{renderTemplate(nextCampaign.c.subject ?? nextCampaign.t.subject, { nombre: "Andrea", evento: "Demo Night" })}</p>
                    <p className="mt-0.5 text-xs text-muted">{nextCampaign.c.name}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={CAMPAIGN_STATUS[nextCampaign.c.status].tone}>{CAMPAIGN_STATUS[nextCampaign.c.status].label}</Badge>
                      <span className="text-xs text-muted">{recipients} destinatarios con opt-in</span>
                    </div>
                  </div>
                </Link>
              ) : (
                <p className="px-5 pb-5 pt-2 text-sm text-muted">No hay campañas en borrador. <Link href="/campaigns/new" className="text-emerald underline">Crear una</Link></p>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* METAS */}
      {show("gtm") && (
        <Card>
          <PanelHeader title="Metas GTM a 90 días" subtitle={`Día ${Math.max(day, 0)} del plan · se miden contra la meta del ${phase.replace("d", "día ")}`} action={<ViewAll href="/metrics" label="Métricas" />} />
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {goals.slice(0, 8).map((g) => {
              const [min, max] = g.targets[phase];
              const ok = g.value >= min;
              return (
                <div key={g.id} className={cn("rounded-2xl border p-4", ok ? "border-emerald/40 bg-mint/60" : "border-line")}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-muted">{g.label}</p>
                    {ok && <Check className="h-4 w-4 text-emerald" />}
                  </div>
                  <p className="mt-1 text-xl font-extrabold">{g.value.toLocaleString("es-MX")}<span className="text-sm font-semibold text-faint"> / {min.toLocaleString("es-MX")}–{max.toLocaleString("es-MX")}</span></p>
                  <Progress value={g.value} max={max} className="mt-2" tone={ok ? "green" : g.value >= min * 0.5 ? "amber" : "red"} />
                  <p className="mt-1.5 text-[10px] text-faint">{g.source}{g.auto ? " · automático" : ""}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
