import Link from "next/link";
import { and, eq, isNotNull, notInArray, type SQL } from "drizzle-orm";
import { TodayRow } from "@/components/leads";
import { btn, Card, Empty, PageHeader, PanelHeader } from "@/components/ui";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { contacts } from "@/db/schema";
import { defaultMessage } from "@/domain/leads";
import { waMessageLink } from "@/domain/phone";
import { todayISO } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const WORKING = ["nuevo", "contactado", "respondio"] as const;

export default async function LeadsTodayPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const access = await requirePagePermission("leads.view");
  const sp = await searchParams;
  const mineOnly = sp.todos !== "1";
  const today = todayISO();
  const in7 = new Date(`${today}T12:00:00`);
  in7.setDate(in7.getDate() + 7);
  const weekEnd = in7.toISOString().slice(0, 10);

  const where: SQL[] = [isNotNull(contacts.leadStatus), notInArray(contacts.leadStatus, ["pago", "perdido"])];
  if (mineOnly) where.push(eq(contacts.ownerId, access.user.id));
  const [users, rows] = await Promise.all([listUsers(), db.select().from(contacts).where(and(...where))]);

  const prio = (c: typeof rows[number]) => c.priority ?? 9;
  const due = rows.filter((c) => c.nextActionOn && c.nextActionOn <= today).sort((a, b) => a.nextActionOn!.localeCompare(b.nextActionOn!) || prio(a) - prio(b));
  const soon = rows.filter((c) => c.nextActionOn && c.nextActionOn > today && c.nextActionOn <= weekEnd).sort((a, b) => a.nextActionOn!.localeCompare(b.nextActionOn!) || prio(a) - prio(b));
  const noPlan = rows.filter((c) => !c.nextActionOn && (WORKING as readonly string[]).includes(c.leadStatus!)).sort((a, b) => prio(a) - prio(b));
  const ownerName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const row = (c: typeof rows[number]) => {
    const message = defaultMessage(c, access.user.name);
    return <TodayRow key={c.id} c={c} owner={ownerName(c.ownerId)} message={message} wa={waMessageLink(c.phoneE164, message)} />;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas · Leads"
        title="Mi día"
        subtitle={mineOnly ? "Tus leads con algo que hacer hoy. Mensaje listo para copiar o abrir en WhatsApp; registra el toque y pasa al siguiente." : "Todos los leads del equipo con algo que hacer."}
        actions={
          <>
            <Link href={mineOnly ? "/leads/hoy?todos=1" : "/leads/hoy"} className={btn("ghost", "sm")}>{mineOnly ? "Ver los de todos" : "Solo los míos"}</Link>
            <Link href="/leads" className={btn("secondary", "sm")}>Kanban</Link>
          </>
        }
      />

      {due.length + soon.length + noPlan.length === 0 && (
        <Empty title="Nada pendiente" text={mineOnly ? "No tienes leads con siguiente paso para hoy. Toma leads sin dueño en el kanban o revisa los de todos." : "Nadie tiene leads con siguiente paso pendiente."} action={<Link href="/leads" className={btn("primary", "sm")}>Ir al kanban</Link>} />
      )}

      {due.length > 0 && (
        <Card>
          <PanelHeader title="Hoy y atrasados" subtitle={`${due.length} lead(s). Los vencidos van primero.`} />
          <div className="mt-2">{due.map(row)}</div>
        </Card>
      )}
      {soon.length > 0 && (
        <Card>
          <PanelHeader title="Próximos 7 días" subtitle={`${soon.length} lead(s)`} />
          <div className="mt-2">{soon.map(row)}</div>
        </Card>
      )}
      {noPlan.length > 0 && (
        <Card>
          <PanelHeader title="Sin siguiente paso" subtitle="Leads en trabajo sin fecha. Ponles una desde la ficha o mándales algo hoy." />
          <div className="mt-2">{noPlan.map(row)}</div>
        </Card>
      )}
    </div>
  );
}
