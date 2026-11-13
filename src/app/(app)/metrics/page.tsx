import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { Check } from "lucide-react";
import { updateGoalCurrent } from "@/actions/goals";
import { Card, cn, PageHeader, PanelHeader, Progress } from "@/components/ui";
import { db } from "@/db";
import { goalsWithValues, gtmDay, gtmPhase } from "@/db/goals";
import { appUsers, bugs, campaignSends, contentPieces, demoRequests } from "@/db/schema";
import { pct } from "@/lib/format";
import { CONTENT_PILLAR, DEMO_STAGE } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const day = gtmDay();
  const phase = gtmPhase(day);
  const since = new Date(Date.now() - 56 * 86400000);
  const [goals, stages, weekly, pillars, sends, bugFlow, [act]] = await Promise.all([
    goalsWithValues(),
    db.select({ stage: demoRequests.stage, n: count() }).from(demoRequests).groupBy(demoRequests.stage),
    db.select({ wk: sql<string>`to_char(date_trunc('week', ${demoRequests.createdAt} at time zone 'America/Mexico_City'), 'YYYY-MM-DD')`, n: count() })
      .from(demoRequests).where(gte(demoRequests.createdAt, since)).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ pillar: contentPieces.pillar, n: count() }).from(contentPieces).where(eq(contentPieces.status, "published")).groupBy(contentPieces.pillar),
    db.select({ status: campaignSends.status, n: count() }).from(campaignSends).groupBy(campaignSends.status),
    db.select({ open: sql<number>`count(*) filter (where ${bugs.status} in ('new','triaged','in_progress'))::int`, fixed: sql<number>`count(*) filter (where ${bugs.status} in ('fixed','verified'))::int` }).from(bugs),
    // Activación (aproximada): usuarios reales con al menos una nota. La regla de 72 h necesita que la app mande la fecha de la primera nota.
    db.select({
      users: sql<number>`count(*)::int`,
      activated: sql<number>`count(*) filter (where ${appUsers.notesTotal} > 0)::int`,
      newWeek: sql<number>`count(*) filter (where ${appUsers.signedUpAt} >= now() - interval '7 days')::int`,
      newWeekActivated: sql<number>`count(*) filter (where ${appUsers.signedUpAt} >= now() - interval '7 days' and ${appUsers.notesTotal} > 0)::int`,
    }).from(appUsers).where(and(eq(appUsers.isTest, false), isNull(appUsers.removedAt))),
  ]);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.now() - (7 - i) * 7 * 86400000);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10);
    return { key, n: weekly.find((w) => w.wk === key)?.n ?? 0 };
  });
  const maxW = Math.max(1, ...weeks.map((w) => w.n));
  const totalDemos = stages.reduce((a, s) => a + s.n, 0);
  const s = (...k: string[]) => sends.filter((x) => k.includes(x.status)).reduce((a, x) => a + x.n, 0);
  const sentTotal = s("sent", "delivered", "opened", "clicked", "bounced", "complained");
  const maxP = Math.max(1, ...pillars.map((p) => p.n));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Métricas" title="Tablero GTM" subtitle={`Día ${Math.max(day, 0)} de 90 · revisión semanal los lunes (J con todo el equipo). Las metas son hipótesis; se recalibran en el día 30.`} />

      <Card>
        <PanelHeader title="Metas por canal" subtitle="Las marcadas 'automático' salen de Ziora Ops; el resto se captura de Meta Insights, TikTok y PostHog." />
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.6fr)] gap-3 border-b border-line px-5 py-2">
              {["KPI", "Día 30", "Día 60", "Día 90", "Actual"].map((h) => <span key={h} className="label">{h}</span>)}
            </div>
            {goals.map((g) => {
              const [min] = g.targets[phase];
              return (
                <div key={g.id} className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.6fr)] items-center gap-3 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0">
                  <span><span className="block text-sm font-semibold">{g.label}</span><span className="text-[11px] text-faint">{g.source}{g.auto ? " · automático" : ""}</span></span>
                  {(["d30", "d60", "d90"] as const).map((p) => (
                    <span key={p} className={cn("text-xs", p === phase ? "font-bold text-ink" : "text-muted")}>{g.targets[p][0].toLocaleString("es-MX")}–{g.targets[p][1].toLocaleString("es-MX")}</span>
                  ))}
                  <span className="flex items-center gap-2">
                    {g.auto ? (
                      <span className="w-20 text-sm font-bold">{g.value.toLocaleString("es-MX")}</span>
                    ) : (
                      <form action={updateGoalCurrent} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={g.id} />
                        <input name="current" type="number" min={0} defaultValue={g.current} className="w-20 rounded-lg border border-line px-2 py-1 text-sm font-bold" />
                        <button className="rounded-full border border-line px-2 py-1 text-[11px] font-semibold text-muted hover:bg-mint">OK</button>
                      </form>
                    )}
                    <Progress value={g.value} max={Math.max(min, 1)} tone={g.value >= min ? "green" : "amber"} />
                    {g.value >= min && <Check className="h-4 w-4 shrink-0 text-emerald" />}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="label">Solicitudes de demo por semana</p>
          <div className="mt-4 flex h-40 items-end gap-2">
            {weeks.map((w) => (
              <div key={w.key} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] font-semibold text-muted">{w.n}</span>
                <div className="w-full rounded-t-lg bg-emerald/80" style={{ height: `${(w.n / maxW) * 120}px`, minHeight: 2 }} />
                <span className="text-[10px] text-faint">{w.key.slice(8)}/{w.key.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="label">Embudo de demos</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {(["requested", "scheduled", "done", "trial", "paid", "no_show", "lost"] as const).map((k) => {
              const n = stages.find((x) => x.stage === k)?.n ?? 0;
              return (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-28 text-sm">{DEMO_STAGE[k].label}</span>
                  <Progress value={n} max={totalDemos} tone={k === "lost" || k === "no_show" ? "red" : "green"} />
                  <span className="w-16 text-right text-xs font-semibold text-muted">{n} · {pct(n, totalDemos)}%</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5">
          <p className="label">Contenido publicado por pilar</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {Object.entries(CONTENT_PILLAR).map(([k, v]) => {
              const n = pillars.find((p) => p.pillar === k)?.n ?? 0;
              return (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-40 text-sm">{v.label}</span>
                  <Progress value={n} max={maxP} />
                  <span className="w-8 text-right text-xs font-semibold text-muted">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5">
          <p className="label">Correo y QA</p>
          <div className="mt-3 grid grid-cols-2 gap-4">
            {[
              ["Correos enviados", sentTotal], ["Tasa de apertura", `${pct(s("opened", "clicked"), sentTotal)}%`],
              ["Tasa de clic", `${pct(s("clicked"), sentTotal)}%`], ["Rebotes + spam", `${pct(s("bounced", "complained"), sentTotal)}%`],
              ["Bugs abiertos", bugFlow[0].open], ["Bugs corregidos", bugFlow[0].fixed],
            ].map(([l, v]) => (
              <div key={l as string}><p className="text-2xl font-extrabold">{v}</p><p className="text-[11px] text-muted">{l}</p></div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="label">Activación de usuarios</p>
          <p className="mt-1 text-[11px] text-muted">Activado = hizo al menos una nota en Ziora. Sin cuentas de prueba. La regla de «primera nota en 72 h» queda pendiente de que la app mande la fecha de la primera nota.</p>
          <div className="mt-3 grid grid-cols-2 gap-4">
            {[
              ["Usuarios activados", `${act.activated} de ${act.users}`], ["Tasa de activación", `${pct(act.activated, act.users)}%`],
              ["Registros en 7 días", act.newWeek], ["De ellos, activados", `${act.newWeekActivated} · ${pct(act.newWeekActivated, act.newWeek)}%`],
            ].map(([l, v]) => (
              <div key={l as string}><p className="text-2xl font-extrabold">{v}</p><p className="text-[11px] text-muted">{l}</p></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
