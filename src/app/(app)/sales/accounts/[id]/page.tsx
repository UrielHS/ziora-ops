import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { ExternalLink, Mail, Phone, Star } from "lucide-react";
import { FollowupRow, NewFollowupButton } from "@/components/followups";
import { AccountFormButton, ContactFormButton, ContractFormButton, DealFormButton } from "@/components/sales";
import { Badge, btn, Card, PageHeader, PanelHeader } from "@/components/ui";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { accountContacts, accounts, contracts, deals, followups, contacts } from "@/db/schema";
import { contractAlerts, isLive, monthlyValue } from "@/domain/sales";
import { fmtDate, money, todayISO, waLink } from "@/lib/format";
import { ACCOUNT_TYPE, BILLING_PERIOD, CONTRACT_STATUS, DEAL_STAGE } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/session";
import { DeleteButton } from "@/components/ui/delete-button";

export const dynamic = "force-dynamic";
const ghost = btn("ghost", "sm");

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const access = await requirePagePermission("sales.view");
  const canEdit = can(access, "sales.manage");
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!account) notFound();
  const today = todayISO();
  const [users, people, ds, cs, fus] = await Promise.all([
    listUsers(),
    db.select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone, title: accountContacts.title, decisionMaker: accountContacts.decisionMaker })
      .from(accountContacts).innerJoin(contacts, eq(contacts.id, accountContacts.contactId)).where(eq(accountContacts.accountId, id)),
    db.select().from(deals).where(eq(deals.accountId, id)).orderBy(desc(deals.updatedAt)),
    db.select().from(contracts).where(eq(contracts.accountId, id)).orderBy(desc(contracts.startsOn)),
    db.select().from(followups).where(eq(followups.accountId, id)).orderBy(asc(followups.status), desc(followups.dueOn)).limit(20),
  ]);
  const canFollow = can(access, "followups.manage");
  const owner = users.find((u) => u.id === account.ownerId)?.name;
  const mrr = cs.filter((c) => isLive(c, today)).reduce((s, c) => s + monthlyValue(c.amountMxn, c.billingPeriod), 0);
  const alerts = contractAlerts(cs, today);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`Ventas · ${ACCOUNT_TYPE[account.type]}`}
        title={account.name}
        subtitle={[account.city, account.therapistsCount ? `${account.therapistsCount} terapeutas` : null, owner ? `Responsable: ${owner}` : null].filter(Boolean).join(" · ")}
        actions={<>
          <Link href="/sales" className={btn("ghost")}>← Ventas</Link>
          {account.website && <a href={account.website} target="_blank" rel="noreferrer" className={btn("ghost")}>Sitio <ExternalLink className="h-3 w-3" /></a>}
          {canEdit && <AccountFormButton a={account} users={users} trigger="Editar" triggerClass={btn("secondary")} />}
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="label">MRR vigente</p><p className="mt-1 text-2xl font-extrabold">{money(mrr)}</p></Card>
        <Card className="p-4"><p className="label">Licencias contratadas</p><p className="mt-1 text-2xl font-extrabold">{cs.filter((c) => isLive(c, today)).reduce((s, c) => s + (c.seats ?? 0), 0)}</p></Card>
        <Card className="p-4">
          <p className="label">Próximo vencimiento</p>
          <p className="mt-1 text-2xl font-extrabold">{alerts[0] ? (alerts[0].kind === "expired" ? "Vencido" : `${alerts[0].days} días`) : "—"}</p>
        </Card>
      </div>

      {account.notes && <Card className="whitespace-pre-wrap p-5 text-sm text-muted">{account.notes}</Card>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <PanelHeader title="Contactos" subtitle="Se guardan en Contactos" action={canEdit && <ContactFormButton accountId={id} triggerClass={ghost} />} />
          <div className="mt-2">
            {people.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Sin contactos todavía.</p>}
            {people.map((p) => (
              <div key={p.id} className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">{p.name}{p.decisionMaker && <Star className="h-3.5 w-3.5 fill-[#D99A2B] text-[#D99A2B]" aria-label="Decide la compra" />}</span>
                  <span className="block truncate text-xs text-muted">{p.title ?? "—"}</span>
                </span>
                {p.email && <a href={`mailto:${p.email}`} className="rounded-full p-1.5 text-muted hover:bg-mint hover:text-emerald" title={p.email}><Mail className="h-4 w-4" /></a>}
                {waLink(p.phone) && <a href={waLink(p.phone)!} target="_blank" rel="noreferrer" className="rounded-full p-1.5 text-muted hover:bg-mint hover:text-emerald" title={p.phone!}><Phone className="h-4 w-4" /></a>}
                {canEdit && <DeleteButton kind="account_contact" id={`${id}:${p.id}`} what={`a ${p.name} de esta cuenta`} warning="Sigue en Contactos; solo deja de estar ligado a la cuenta." label="Quitar" />}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <PanelHeader title="Oportunidades" action={canEdit && <DealFormButton accountId={id} users={users} triggerClass={ghost} />} />
          <div className="mt-2">
            {ds.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Sin oportunidades.</p>}
            {ds.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-[#EFEDE6] px-5 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  {canEdit ? (
                    <DealFormButton d={d} users={users} trigger={<span className="text-sm font-semibold hover:text-emerald">{d.name}</span>} triggerClass="text-left" />
                  ) : <span className="text-sm font-semibold">{d.name}</span>}
                  <span className="block text-xs text-muted">
                    {d.amountMxn ? `${money(d.amountMxn)} ${BILLING_PERIOD[d.billingPeriod].toLowerCase()}` : "Sin monto"}
                    {d.seats ? ` · ${d.seats} licencias` : ""}{d.expectedCloseOn ? ` · cierre ${fmtDate(d.expectedCloseOn)}` : ""}
                    {d.lostReason ? ` · ${d.lostReason}` : ""}
                  </span>
                </span>
                <Badge tone={DEAL_STAGE[d.stage].tone}>{DEAL_STAGE[d.stage].label}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <PanelHeader title="Seguimiento" action={canFollow && <NewFollowupButton users={users} accountId={id} appUserLabel={account.name} triggerClass={ghost} />} />
        <div className="mt-2">
          {fus.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Sin seguimientos todavía.</p>}
          {fus.map((f) => <FollowupRow key={f.id} f={f} subject={account.name} owner={users.find((u) => u.id === f.ownerId)?.name} canEdit={canFollow} />)}
        </div>
      </Card>

      <Card>
        <PanelHeader title="Contratos" action={canEdit && <ContractFormButton accountId={id} triggerClass={ghost} />} />
        <div className="mt-2">
          {cs.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Sin contratos. Al ganar una oportunidad se crea el borrador.</p>}
          {cs.map((c) => {
            const alert = alerts.find((a) => a.contractId === c.id);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-[#EFEDE6] px-5 py-3 last:border-b-0">
                <span className="min-w-0 flex-1">
                  {canEdit ? (
                    <ContractFormButton c={c} accountId={id} triggerClass="text-left" trigger={<span className="text-sm font-semibold hover:text-emerald"><span className="mr-2 text-xs text-faint">CTR-{c.number}</span>{c.title}</span>} />
                  ) : <span className="text-sm font-semibold"><span className="mr-2 text-xs text-faint">CTR-{c.number}</span>{c.title}</span>}
                  <span className="block text-xs text-muted">
                    {money(c.amountMxn)} {BILLING_PERIOD[c.billingPeriod].toLowerCase()}{c.seats ? ` · ${c.seats} licencias` : ""}
                    {" · "}{fmtDate(c.startsOn)} → {fmtDate(c.endsOn)}{c.autoRenew ? " · renovación automática" : ""}
                  </span>
                </span>
                {alert && <Badge tone={alert.kind === "expired" ? "red" : "amber"}>{alert.kind === "expired" ? "Vencido" : `Vence en ${alert.days} d`}</Badge>}
                <Badge tone={CONTRACT_STATUS[c.status].tone}>{CONTRACT_STATUS[c.status].label}</Badge>
                {c.documentUrl && <a href={c.documentUrl} target="_blank" rel="noreferrer" className={ghost}>PDF <ExternalLink className="h-3 w-3" /></a>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
