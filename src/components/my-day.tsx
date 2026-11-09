import Link from "next/link";
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or } from "drizzle-orm";
import { ArrowUpRight } from "lucide-react";
import { Card, cn } from "@/components/ui";
import { db } from "@/db";
import { reviewsForPieces } from "@/db/content-review";
import { appUsers, contacts, contentPieces, contentSuggestions, contracts, deals, demoRequests, followups, tickets } from "@/db/schema";
import { contractAlerts, staleDeals } from "@/domain/sales";
import { todayISO } from "@/lib/format";
import { can, CONTENT_REVIEWER_ROLES } from "@/lib/permissions";
import type { SessionAccess } from "@/lib/session";

type Item = { label: string; n: number; href: string; urgent?: boolean };

/** Pendientes de hoy según los roles de la persona. Si no tiene nada, no se muestra. */
export async function MyDay({ access }: { access: SessionAccess }) {
  const { user, roles } = access;
  const has = (...r: typeof roles) => r.some((x) => roles.includes(x));
  const today = todayISO();
  const now = new Date();
  const items: Item[] = [];

  if (has("sales", "ceo")) {
    const [cs, ds] = await Promise.all([db.select().from(contracts), db.select().from(deals)]);
    const alerts = contractAlerts(cs, today);
    items.push({ label: "Contratos por vencer o vencidos", n: alerts.length, href: "/sales", urgent: alerts.some((a) => a.kind === "expired" || a.days <= 30) });
    items.push({ label: "Oportunidades sin movimiento (14 días)", n: staleDeals(ds, now).length, href: "/sales" });
  }

  if (can(access, "followups.manage")) {
    const [[due], [late]] = await Promise.all([
      db.select({ n: count() }).from(followups).where(and(eq(followups.status, "pending"), eq(followups.ownerId, user.id), lte(followups.dueOn, today))),
      db.select({ n: count() }).from(followups).where(and(eq(followups.status, "pending"), eq(followups.ownerId, user.id), lte(followups.dueOn, new Date(now.getTime() - 86400000).toISOString().slice(0, 10)))),
    ]);
    items.push({ label: "Mis seguimientos de hoy", n: due.n, href: "/followups", urgent: late.n > 0 });
  }

  if (can(access, "leads.view")) {
    const mine = and(eq(contacts.ownerId, user.id), isNotNull(contacts.leadStatus), notInArray(contacts.leadStatus, ["pago", "perdido"]));
    const [[due], [late]] = await Promise.all([
      db.select({ n: count() }).from(contacts).where(and(mine, lte(contacts.nextActionOn, today))),
      db.select({ n: count() }).from(contacts).where(and(mine, lt(contacts.nextActionOn, today))),
    ]);
    items.push({ label: "Mis leads de hoy", n: due.n, href: "/leads/hoy", urgent: late.n > 0 });
  }

  if (has("clinical_director", "sales", "ceo")) {
    const endOfDay = new Date(`${today}T23:59:59-06:00`);
    const [[d]] = await Promise.all([
      db.select({ n: count() }).from(demoRequests).where(and(gte(demoRequests.scheduledAt, new Date(`${today}T00:00:00-06:00`)), lte(demoRequests.scheduledAt, endOfDay), inArray(demoRequests.stage, ["requested", "scheduled"]))),
    ]);
    items.push({ label: "Demos de hoy", n: d.n, href: "/followups" });
  }

  if (has(...CONTENT_REVIEWER_ROLES)) {
    const candidates = await db.select({ id: contentPieces.id, status: contentPieces.status }).from(contentPieces)
      .where(or(eq(contentPieces.status, "legal_review"), and(eq(contentPieces.status, "scheduled"), isNotNull(contentPieces.reviewRequestedAt))));
    const reviews = await reviewsForPieces(db, candidates.map((p) => p.id));
    // Pendiente: aún no aprobada por nadie (o con cambios) y yo no la he aprobado.
    const pendingMine = candidates.filter((p) => !reviews.get(p.id)?.complete && reviews.get(p.id)?.reviews.find((r) => r.reviewerId === user.id)?.decision !== "approved").length;
    items.push({ label: "Piezas esperando mi revisión", n: pendingMine, href: "/content/review", urgent: pendingMine > 0 });
  }

  if (has("marketing")) {
    const [[sg], [ch]] = await Promise.all([
      db.select({ n: count() }).from(contentSuggestions).where(eq(contentSuggestions.status, "new")),
      db.select({ n: count() }).from(contentPieces).where(and(eq(contentPieces.status, "approved"), isNull(contentPieces.publishOn))),
    ]);
    items.push({ label: "Sugerencias por revisar", n: sg.n, href: "/content/suggestions" });
    items.push({ label: "Aprobadas sin fecha de publicación", n: ch.n, href: "/content" });
  }

  if (has("dev_qa")) {
    const [[nw], [info]] = await Promise.all([
      db.select({ n: count() }).from(tickets).where(eq(tickets.status, "new")),
      db.select({ n: count() }).from(tickets).where(and(eq(tickets.viability, "needs_info"), inArray(tickets.status, ["new", "evaluating"]))),
    ]);
    items.push({ label: "Tickets por evaluar", n: nw.n, href: "/tickets", urgent: nw.n > 0 });
    items.push({ label: "Tickets esperando información", n: info.n, href: "/tickets?ver=evaluar" });
  }

  if (has("operations", "ceo") && can(access, "customers.view")) {
    const [[inactive]] = await Promise.all([
      db.select({ n: count() }).from(appUsers).where(and(isNull(appUsers.removedAt), eq(appUsers.isTest, false), lte(appUsers.lastActiveAt, new Date(now.getTime() - 14 * 86400000)))),
    ]);
    items.push({ label: "Usuarios de Ziora inactivos (14 días)", n: inactive.n, href: "/customers?estado=inactivo" });
  }

  // Lo que está en cero no ocupa espacio; si todo está en cero, el bloque desaparece.
  const visible = items.filter((i) => i.n > 0);
  if (visible.length === 0) return null;

  return (
    <Card className="p-5">
      <p className="label mb-3">Mi día</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((i) => (
          <Link key={i.label} href={i.href} className={cn("group flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors", i.urgent ? "border-warn/30 bg-warn-bg hover:border-warn/50" : "border-line bg-white hover:border-emerald/40")}>
            <span className={cn("text-2xl font-extrabold", i.urgent && "text-warn")}>{i.n}</span>
            <span className="flex-1 text-sm leading-tight">{i.label}</span>
            <ArrowUpRight className="h-4 w-4 text-faint group-hover:text-emerald" />
          </Link>
        ))}
      </div>
    </Card>
  );
}
