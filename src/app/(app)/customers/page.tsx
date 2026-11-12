import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { Activity, ArrowDown, ArrowUp, ArrowUpDown, CircleDollarSign, HeartPulse, Users } from "lucide-react";
import { savePlanPrice } from "@/actions/followups";
import { markAppUserTest } from "@/actions/app-users";
import { NewFollowupButton } from "@/components/followups";
import { Badge, btn, Card, cn, Empty, Field, inputCls, Kpi, PageHeader, PanelHeader, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { appUserDaily, appUsers, communities, followups, planPrices } from "@/db/schema";
import { ACTIVE_DAYS, estimatedMrr, isActive, isPaying, payState, realMrr, summarizeByPlan, type PayState } from "@/domain/app-users";
import { fmtDate, money, relative } from "@/lib/format";
import { BILLING_PERIOD, HEALTH } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
const PAGE = 100;

// Estados de la suscripción (Stripe) en español; lo desconocido se muestra tal cual.
const STATUS_LABELS: Record<string, string> = {
  active: "Activa", trialing: "En prueba", past_due: "Pago atrasado", unpaid: "Sin pagar",
  incomplete: "Pago incompleto", incomplete_expired: "Pago vencido", canceled: "Cancelada", cancelled: "Cancelada", free: "Gratis",
};
const statusLabel = (s: string) => STATUS_LABELS[s.toLowerCase()] ?? s;
// Columnas ordenables (?orden=…&dir=asc|desc). Los nulos (nunca entró, sin pago) van al final en ambos sentidos.
const SORT = {
  terapeuta: appUsers.name, plan: appUsers.plan, estado: appUsers.status, registro: appUsers.signedUpAt,
  ultima: appUsers.lastActiveAt, pacientes: appUsers.patientCount, sesiones: appUsers.sessionsLast30d, pago: appUsers.mrrCents,
} as const;
type SortKey = keyof typeof SORT;
const DEFAULT_SORT: SortKey = "ultima";
const isSortKey = (k: string | undefined): k is SortKey => !!k && k in SORT;

const PAY: Record<PayState, { label: string; tone: "green" | "amber" | "gray" | "red" }> = {
  paying: { label: "Paga", tone: "green" }, courtesy: { label: "Cortesía", tone: "amber" }, trial: { label: "Prueba", tone: "amber" },
  cancelled: { label: "Cancelada", tone: "red" }, none: { label: "Sin suscripción", tone: "gray" },
};

function statusTone(s: string, active: boolean) {
  if (/cancel|expired/i.test(s)) return "red" as const;
  if (/past_due|unpaid|incomplete|trial/i.test(s)) return "amber" as const;
  return active ? "green" as const : "gray" as const;
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; plan?: string; estado?: string; p?: string; orden?: string; dir?: string; origen?: string }> }) {
  const sp = await searchParams;
  const access = await requirePagePermission("customers.view");
  const showRevenue = can(access, "revenue.view");
  const canFollow = can(access, "followups.manage");
  const now = new Date();
  const activeSince = new Date(now.getTime() - ACTIVE_DAYS * 86400000);
  const page = Math.max(0, Number(sp.p ?? 0) || 0);
  const sortKey: SortKey = isSortKey(sp.orden) ? sp.orden : DEFAULT_SORT;
  // Por defecto, números y fechas de mayor a menor; texto de la A a la Z.
  const textSort = sortKey === "terapeuta" || sortKey === "plan" || sortKey === "estado";
  const dir: "asc" | "desc" = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : textSort ? "asc" : "desc";
  const orderBy = dir === "asc" ? sql`${SORT[sortKey]} asc nulls last` : sql`${SORT[sortKey]} desc nulls last`;

  const where: SQL[] = [];
  // Las cuentas de prueba solo se ven al pedirlas; en todo lo demás no existen.
  where.push(eq(appUsers.isTest, sp.estado === "prueba"));
  if (sp.estado === "baja") where.push(isNotNull(appUsers.removedAt));
  else if (sp.estado !== "prueba") where.push(isNull(appUsers.removedAt));
  if (sp.estado === "activo") where.push(gte(appUsers.lastActiveAt, activeSince));
  if (sp.estado === "inactivo") where.push(or(lt(appUsers.lastActiveAt, activeSince), isNull(appUsers.lastActiveAt))!);
  if (sp.plan) where.push(eq(appUsers.plan, sp.plan));
  if (sp.origen === "comunidad") where.push(or(isNotNull(appUsers.communityId), sql`${appUsers.attribution}->>'utm_medium' = 'comunidad'`, eq(appUsers.trialKind, "community"))!);
  if (sp.q) where.push(or(ilike(appUsers.email, `%${sp.q}%`), ilike(appUsers.name, `%${sp.q}%`))!);

  const [users, team, prices, rows, [{ total }], trend, [lastSync], lastHealth, [{ hiddenTest }], communityRows] = await Promise.all([
    db.select().from(appUsers).where(and(isNull(appUsers.removedAt), eq(appUsers.isTest, false))),
    listUsers(),
    db.select().from(planPrices).orderBy(asc(planPrices.plan)),
    db.select().from(appUsers).where(and(...where)).orderBy(orderBy, asc(appUsers.email)).limit(PAGE).offset(page * PAGE),
    db.select({ total: sql<number>`count(*)::int` }).from(appUsers).where(and(...where)),
    db.select({
      day: appUserDaily.day, users: sql<number>`sum(${appUserDaily.users})::int`, active: sql<number>`sum(${appUserDaily.active})::int`,
      paying: sql<number>`sum(${appUserDaily.paying})::int`, mrr: sql<number>`sum(${appUserDaily.estimatedMrrMxn})::int`,
    }).from(appUserDaily).where(gte(appUserDaily.day, new Date(now.getTime() - 60 * 86400000).toISOString().slice(0, 10))).groupBy(appUserDaily.day).orderBy(asc(appUserDaily.day)),
    db.select({ at: sql<Date>`max(${appUsers.syncedAt})` }).from(appUsers),
    db.selectDistinctOn([followups.appUserUid], { uid: followups.appUserUid, health: followups.health })
      .from(followups).where(and(eq(followups.status, "done"), isNotNull(followups.health), isNotNull(followups.appUserUid)))
      .orderBy(followups.appUserUid, desc(followups.completedAt)),
    db.select({ hiddenTest: sql<number>`count(*)::int` }).from(appUsers).where(and(eq(appUsers.isTest, true), isNull(appUsers.removedAt))),
    db.select({ id: communities.id, name: communities.name }).from(communities),
  ]);
  const communityName = new Map(communityRows.map((c) => [c.id, c.name]));

  const byPlan = summarizeByPlan(users, prices, now);
  const active = users.filter((u) => isActive(u.lastActiveAt, now)).length;
  const paying = users.filter((u) => isPaying(u, prices)).length;
  const courtesy = users.filter((u) => payState(u, prices) === "courtesy").length;
  const patients = users.reduce((s, u) => s + u.patientCount, 0);
  const plansSeen = [...new Set([...users.map((u) => u.plan), ...prices.map((p) => p.plan)])].sort();
  const withReal = users.filter((u) => realMrr(u) !== null).length;
  const unpriced = [...new Set(users.filter((u) => realMrr(u) === null).map((u) => u.plan))].filter((p) => !prices.some((x) => x.plan === p));
  const mrrNote = withReal === users.length && users.length > 0
    ? "Real, de las suscripciones de Stripe"
    : unpriced.length ? `Sin precio: ${unpriced.join(", ")}`
    : withReal ? `Stripe en ${withReal} cuentas; el resto plan × precio` : "Plan × precio; falta conectar pagos";
  const maxTrend = Math.max(1, ...trend.map((t) => t.users));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, plan: sp.plan, estado: sp.estado, orden: sp.orden, dir: sp.dir, origen: sp.origen, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/customers?${p}`;
  };
  // Encabezado ordenable: primer clic ordena por esa columna (sentido por defecto), el segundo invierte.
  const Th = ({ k, children, align }: { k: SortKey; children: React.ReactNode; align?: "right" }) => {
    const on = sortKey === k;
    const nextDir = on ? (dir === "asc" ? "desc" : "asc") : undefined;
    const Icon = on ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th className={cn("px-2 font-semibold", align === "right" && "text-right", k === "terapeuta" && "px-5 py-2")}>
        <Link href={qs({ orden: k, dir: nextDir, p: undefined })} aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("inline-flex items-center gap-1 hover:text-ink", on && "text-ink")}>
          {children}<Icon className={cn("h-3 w-3", on ? "text-emerald" : "text-faint")} />
        </Link>
      </th>
    );
  };

  if (!lastSync?.at) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Clientes" title="Usuarios de Ziora" />
        <Empty title="Todavía no hay datos de la app" text="Falta conectar el endpoint /ops/snapshot de ziora-api. La especificación está en docs/API-ZIORA-APP.md; cuando esté listo, los usuarios se sincronizan cada hora." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Clientes"
        title="Usuarios de Ziora"
        subtitle={`Sincronizado ${relative(lastSync.at)} · activo = entró en los últimos ${ACTIVE_DAYS} días · de los pacientes solo se guarda el número${hiddenTest ? ` · ${hiddenTest} cuentas de prueba ocultas` : ""}`}
        actions={showRevenue && <PricesButton plans={plansSeen} prices={prices} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Usuarios" value={users.length} note={`${paying} pagan en Stripe${courtesy ? ` · ${courtesy} de cortesía` : ""}`} icon={Users} />
        <Kpi label="Activos" value={`${users.length ? Math.round((active / users.length) * 100) : 0}%`} note={`${active} entraron en ${ACTIVE_DAYS} días`} icon={Activity} />
        <Kpi label="Pacientes registrados" value={patients.toLocaleString("es-MX")} note={`${users.length ? (patients / users.length).toFixed(1) : 0} por terapeuta`} icon={HeartPulse} />
        {showRevenue
          ? <Kpi label={withReal === users.length && users.length > 0 ? "MRR" : "MRR estimado"} value={money(Math.round(estimatedMrr(users, prices)))} note={mrrNote} icon={CircleDollarSign} highlight />
          : <Kpi label="Planes" value={byPlan.length} icon={CircleDollarSign} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <p className="label">Usuarios y activos · últimos 60 días</p>
          {trend.length < 2 ? <p className="mt-3 text-sm text-muted">La tendencia aparece después de unos días de sincronización.</p> : (
            <div className="mt-4 flex h-36 items-end gap-[3px]">
              {trend.map((t) => (
                <div key={t.day} className="group relative flex flex-1 flex-col justify-end" style={{ height: "100%" }} title={`${fmtDate(t.day)} · ${t.users} usuarios · ${t.active} activos · ${t.paying} de pago`}>
                  <div className="flex w-full flex-col justify-end rounded-t-sm bg-[#DCEFE6]" style={{ height: `${(t.users / maxTrend) * 100}%` }}>
                    <div className="w-full rounded-t-sm bg-emerald" style={{ height: `${t.users ? (t.active / t.users) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-4 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#DCEFE6]" />Usuarios</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald" />Activos</span>
          </div>
        </Card>
        <Card>
          <PanelHeader title="Por plan" />
          <div className="mt-2">
            {byPlan.map((p) => (
              <Link key={p.plan} href={qs({ plan: sp.plan === p.plan ? undefined : p.plan, p: undefined })} className={cn("flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-2.5 text-sm last:border-b-0 hover:bg-[#FAF9F5]", sp.plan === p.plan && "bg-mint")}>
                <span className="flex-1 font-semibold">{prices.find((x) => x.plan === p.plan)?.label ?? p.plan}</span>
                <span className="text-muted">{p.users} · {p.active} activos</span>
                {showRevenue && <span className="w-20 text-right font-semibold">{money(p.estimatedMrrMxn)}</span>}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <form action="/customers" className="flex flex-wrap items-center gap-2 px-5 pt-5">
          <input name="q" defaultValue={sp.q} placeholder="Buscar por correo o nombre" className={cn(inputCls, "max-w-xs rounded-full")} />
          {sp.plan && <input type="hidden" name="plan" value={sp.plan} />}
          {sp.origen && <input type="hidden" name="origen" value={sp.origen} />}
          <Select name="estado" defaultValue={sp.estado} placeholder="Todos" className="w-36" options={[["activo", "Activos"], ["inactivo", "Inactivos"], ["baja", "Dados de baja"], ["prueba", "Cuentas de prueba"]]} />
          <button className={btn("ghost", "sm")}>Filtrar</button>
          <Link href={qs({ origen: sp.origen === "comunidad" ? undefined : "comunidad", p: undefined })} className={cn(btn(sp.origen === "comunidad" ? "secondary" : "ghost", "sm"))}>Origen: comunidad</Link>
          <span className="ml-auto text-xs text-faint">{total} usuarios</span>
        </form>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <Th k="terapeuta">Terapeuta</Th><Th k="plan">Plan</Th><Th k="estado">Estado</Th><Th k="pago">Pago</Th>
              <Th k="registro">Registro</Th><Th k="ultima">Última vez</Th><Th k="pacientes" align="right">Pacientes</Th><Th k="sesiones" align="right">Sesiones 30d</Th>
              <th className="px-2 font-semibold">Salud</th><th className="px-5" />
            </tr></thead>
            <tbody>
              {rows.map((u) => {
                const health = lastHealth.find((h) => h.uid === u.uid)?.health;
                const act = isActive(u.lastActiveAt, now);
                const pay = payState(u, prices);
                const real = realMrr(u);
                return (
                  <tr key={u.uid} className="border-b border-[#EFEDE6] last:border-b-0">
                    <td className="px-5 py-2.5"><span className="block font-semibold">{u.name ?? "—"}</span><span className="block text-xs text-muted">{u.email}</span>
                      {(u.communityId || u.attribution?.utm_medium === "comunidad") && (
                        <Badge tone="green">{u.communityId ? `Comunidad: ${communityName.get(u.communityId) ?? "—"}` : "Página /comunidad"}</Badge>
                      )}
                      {u.trialKind === "community" && (
                        <Badge tone="amber">Prueba de comunidad{u.trialEndsAt ? ` · vence ${fmtDate(u.trialEndsAt, { day: "numeric", month: "short", year: "2-digit" })}` : ""}</Badge>
                      )}</td>
                    <td className="px-2">{prices.find((p) => p.plan === u.plan)?.label ?? u.plan}</td>
                    <td className="px-2">{u.removedAt ? <Badge tone="gray">Baja</Badge> : <Badge tone={statusTone(u.status, act)}>{statusLabel(u.status)}{u.cancelAtPeriodEnd && !/cancel/i.test(u.status) ? " · cancela al cierre" : ""}{!act && !/cancel/i.test(u.status) ? " · inactivo" : ""}</Badge>}</td>
                    <td className="px-2">
                      <Badge tone={PAY[pay].tone}>{PAY[pay].label}</Badge>
                      {pay === "paying" && real !== null && <span className="ml-1.5 text-xs text-muted">{money(real)}/mes</span>}
                    </td>
                    <td className="px-2 text-muted">{u.signedUpAt ? fmtDate(u.signedUpAt, { day: "numeric", month: "short", year: "2-digit" }) : "—"}</td>
                    <td className="px-2 text-muted">{u.lastActiveAt ? relative(u.lastActiveAt) : "Nunca"}</td>
                    <td className="px-2 text-right font-semibold">{u.patientCount}</td>
                    <td className="px-2 text-right">{u.sessionsLast30d}</td>
                    <td className="px-2">{health ? <Badge tone={HEALTH[health].tone}>{HEALTH[health].label}</Badge> : <span className="text-faint">—</span>}</td>
                    <td className="px-5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canFollow && !u.removedAt && !u.isTest && <NewFollowupButton users={team} appUserUid={u.uid} appUserLabel={u.name ?? u.email} trigger="Seguimiento" triggerClass={btn("ghost", "sm")} />}
                        <ActionForm action={markAppUserTest} className="inline">
                          <input type="hidden" name="uid" value={u.uid} />
                          <input type="hidden" name="isTest" value={u.isTest ? "0" : "1"} />
                          <Submit variant="ghost" className="!px-2 !py-1 text-xs">{u.isTest ? "No es de prueba" : "Es de prueba"}</Submit>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={10} className="px-5 py-6 text-center text-muted">Sin resultados.</td></tr>}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div className="flex justify-between px-5 py-3 text-xs">
            {page > 0 ? <Link href={qs({ p: String(page - 1) })} className={btn("ghost", "sm")}>← Anteriores</Link> : <span />}
            {(page + 1) * PAGE < total && <Link href={qs({ p: String(page + 1) })} className={btn("ghost", "sm")}>Siguientes →</Link>}
          </div>
        )}
      </Card>
    </div>
  );
}

function PricesButton({ plans, prices }: { plans: string[]; prices: (typeof planPrices.$inferSelect)[] }) {
  return (
    <Modal trigger="Precios de planes" title="Precios para el MRR estimado" triggerClass={btn("ghost")} wide>
      <p className="mb-4 text-sm text-muted">Mientras se conecta la fuente real de pagos, el ingreso se estima como plan × precio. Marca como &quot;de pago&quot; solo los planes que cobran.</p>
      <div className="flex flex-col gap-3">
        {plans.map((plan) => {
          const p = prices.find((x) => x.plan === plan);
          return (
            <ActionForm key={plan} action={savePlanPrice} className="grid grid-cols-2 items-end gap-2 rounded-2xl border border-line bg-white p-3 sm:grid-cols-[1fr_1fr_110px_120px_auto_auto]">
              <input type="hidden" name="plan" value={plan} />
              <Field label={`Plan "${plan}"`}><input name="label" required defaultValue={p?.label ?? plan} className={inputCls} /></Field>
              <Field label="Precio MXN"><input name="priceMxn" type="number" min={0} required defaultValue={p?.priceMxn ?? 0} className={inputCls} /></Field>
              <Field label="Cobro"><Select name="billingPeriod" defaultValue={p?.billingPeriod ?? "monthly"} options={Object.entries(BILLING_PERIOD)} /></Field>
              <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="paying" defaultChecked={p?.paying ?? plan !== "free"} className="h-4 w-4 accent-[#059669]" /> De pago</label>
              <Submit variant="secondary">Guardar</Submit>
            </ActionForm>
          );
        })}
      </div>
    </Modal>
  );
}
