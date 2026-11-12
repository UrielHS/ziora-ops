import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Building2, Mail, MailX, MessageCircle, Phone } from "lucide-react";
import { convertToAccountAction } from "@/actions/leads";
import { ActionForm, Submit } from "@/components/ui/form";
import { AttributionPanel } from "@/components/communities";
import { CadencePanel, ChannelInvalidButton, LeadPriorityBadge, LeadStatusBadge, LeadStatusForm, MyLinks, NextActionForm, NoteForm, Timeline, TouchButtons, WhatsAppButton } from "@/components/leads";
import { CopyButton } from "@/components/ui/copy";
import { Avatar, Badge, btn, Card, PageHeader, PanelHeader } from "@/components/ui";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { accountContacts, accounts, communities, communityPosts, contactConsents, contacts, contactTags, sequences } from "@/db/schema";
import { defaultMessage, loadTimeline } from "@/domain/leads";
import { loadCadence } from "@/domain/sequences";
import { getSellerProfile, referralCodeFrom, referralLinkWithUtm, utmCampaignFor } from "@/domain/sellers";
import { waMessageLink } from "@/domain/phone";
import { fmtDate } from "@/lib/format";
import { CITY, CONTACT_SOURCE, CONTACT_TAG } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const access = await requirePagePermission("leads.view");
  const canManage = can(access, "leads.manage");
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!c) notFound();
  const [users, tags, consents, timeline, [account], cadenceMap, activeSequences, myProfile] = await Promise.all([
    listUsers(),
    db.select({ tag: contactTags.tag }).from(contactTags).where(eq(contactTags.contactId, id)),
    db.select().from(contactConsents).where(eq(contactConsents.contactId, id)),
    loadTimeline(db, id),
    db.select({ id: accounts.id, name: accounts.name }).from(accountContacts).innerJoin(accounts, eq(accounts.id, accountContacts.accountId)).where(eq(accountContacts.contactId, id)).limit(1),
    loadCadence(db, [id]),
    db.select({ id: sequences.id, name: sequences.name }).from(sequences).where(eq(sequences.active, true)).orderBy(sequences.name),
    getSellerProfile(db, access.user.id),
  ]);
  const cadence = cadenceMap.get(id);
  // Atribución de comunidad: de qué grupo y post vino, con qué UTM y quién lo registró.
  const hasAttribution = !!c.communityId || !!c.communityPostId || c.utm?.utm_medium === "comunidad";
  const [attrCommunity] = c.communityId ? await db.select({ name: communities.name }).from(communities).where(eq(communities.id, c.communityId)) : [];
  const [attrPost] = c.communityPostId ? await db.select({ code: communityPosts.code }).from(communityPosts).where(eq(communityPosts.id, c.communityPostId)) : [];
  const myLinks = myProfile ? {
    referral: myProfile.referralUrl ? referralLinkWithUtm(myProfile.referralUrl, { campaign: utmCampaignFor(c.source), code: referralCodeFrom(myProfile.referralUrl) }) : null,
    booking: myProfile.bookingUrl, discountCode: myProfile.discountCode,
  } : null;
  // El panel de cadencia se muestra a quien puede entrar en una (nuevo/contactado) o ya pasó por una.
  const showCadence = c.leadStatus === "nuevo" || c.leadStatus === "contactado" || !!cadence;
  // Solo quien dirige o coordina una clínica se convierte en cuenta B2B; el resto se vende como persona.
  const looksB2B = tags.some((t) => t.tag === "clinic") || /director|coordinador/i.test(c.jobTitle ?? "");
  const owner = users.find((u) => u.id === c.ownerId)?.name ?? null;
  const fromSequence = cadence?.status === "activa" && !!cadence.pendingText;
  const message = fromSequence ? cadence.pendingText! : defaultMessage(c, access.user.name);
  const wa = waMessageLink(c.phoneE164, message);
  const city = c.cityName ?? (c.city ? CITY[c.city] : null);
  const profile = ([
    ["Puesto", c.jobTitle], ["Empresa o clínica", c.company], ["Pacientes por semana", c.patientsPerWeek], ["Enfoque", c.approach],
    ["Cómo documenta", c.documentation], ["Usa IA", c.aiUsage], ["Ciudad", city],
  ] as [string, string | null | undefined][]).filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas · Leads"
        title={c.name}
        subtitle={[c.jobTitle, city, CONTACT_SOURCE[c.source] ?? c.source, c.segment].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link href="/leads" className={btn("ghost", "sm")}>← Leads</Link>
            {c.email && <a href={`mailto:${c.email}`} className={btn("ghost", "sm")}><Mail className="h-3.5 w-3.5" /> Correo</a>}
            <WhatsAppButton href={wa} />
            {account ? (
              <Link href={`/sales/accounts/${account.id}`} className={btn("secondary", "sm")}><Building2 className="h-3.5 w-3.5" /> Ver cuenta: {account.name}</Link>
            ) : canManage && looksB2B ? (
              <ActionForm action={convertToAccountAction} className="contents">
                <input type="hidden" name="id" value={c.id} />
                <Submit variant="secondary" className="!py-1.5 !text-xs"><Building2 className="h-3.5 w-3.5" /> Convertir en cuenta</Submit>
              </ActionForm>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <LeadStatusBadge status={c.leadStatus} />
        <LeadPriorityBadge priority={c.priority} />
        {c.lostReason && <Badge tone="red">{c.lostReason}</Badge>}
        {tags.map((t) => <Badge key={t.tag} tone="gray">{CONTACT_TAG[t.tag] ?? t.tag}</Badge>)}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted"><Avatar name={owner} size={20} />{owner ?? "Sin dueño"}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <PanelHeader title="Siguiente paso" subtitle={c.nextActionOn ? `Para el ${fmtDate(c.nextActionOn, { dateStyle: "medium" })}` : "Sin fecha"} />
            <div className="px-5 pb-5">
              {canManage ? <NextActionForm id={c.id} text={c.nextAction} on={c.nextActionOn} /> : <p className="text-sm">{c.nextAction ?? "—"}</p>}
            </div>
          </Card>

          {showCadence && (
            <Card>
              <PanelHeader title="Cadencia" subtitle="Correos automáticos y WhatsApp listos en Mi día. Se detiene sola cuando responde, se pierde o se da de baja." />
              <div className="px-5 pb-5"><CadencePanel contactId={c.id} cadence={cadence} sequences={activeSequences} canManage={canManage} /></div>
            </Card>
          )}

          {canManage && (
            <Card>
              <PanelHeader title="Registrar toque" subtitle="Lo que hiciste hoy. El primer toque pasa el lead a Contactado." />
              <div className="flex flex-col gap-3 px-5 pb-5">
                <TouchButtons id={c.id} />
                <div className="rounded-2xl border border-line bg-[#FBFAF6] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="label">{fromSequence ? `Mensaje de la secuencia «${cadence.sequenceName}»` : "Mensaje sugerido"}</p>
                    <CopyButton text={message} />
                  </div>
                  <textarea readOnly value={message} rows={4} className="mt-2 w-full resize-none bg-transparent text-sm outline-none" />
                </div>
              </div>
            </Card>
          )}

          {canManage && (
            <Card>
              <PanelHeader title="Mis ligas y códigos" subtitle="Para pegar en el WhatsApp o el correo: tu liga de prueba (referido), tu calendario y los códigos de descuento." />
              <MyLinks links={myLinks} />
            </Card>
          )}

          {hasAttribution && (
            <Card>
              <PanelHeader title="De dónde vino" subtitle="Comunidad y post que lo trajeron." />
              <div className="pt-3">
                <AttributionPanel
                  communityId={c.communityId} communityName={attrCommunity?.name ?? null} postCode={attrPost?.code ?? c.utm?.utm_term ?? null}
                  utm={c.utm ?? {}} registeredBy={users.find((u) => u.id === c.registeredById)?.name ?? null} registeredAt={c.leadRegisteredAt}
                />
              </div>
            </Card>
          )}

          <Card>
            <PanelHeader title="Datos de contacto" />
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 pb-5 text-sm sm:grid-cols-2">
              <div><dt className="label">Correo</dt><dd className="flex flex-wrap items-center gap-2 break-all">{c.email ?? "—"}{c.email && <CopyButton text={c.email} />}{c.emailInvalidAt && <Badge tone="red">Incorrecto</Badge>}</dd></div>
              <div><dt className="label">Teléfono</dt><dd className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-muted" />{c.phone ?? "—"}{c.phoneE164 && <span className="text-xs text-faint">· +{c.phoneE164}</span>}{(c.phoneE164 || c.phone) && <CopyButton text={c.phoneE164 ? `+${c.phoneE164}` : c.phone!} />}{c.phoneInvalidAt && <Badge tone="red">Incorrecto</Badge>}</dd></div>
              {profile.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd>{v}</dd></div>)}
            </dl>
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              {["email", "whatsapp"].map((ch) => {
                const k = consents.find((x) => x.channel === ch);
                const label = ch === "email" ? "Correo" : "WhatsApp";
                return k?.optedOutAt ? <Badge key={ch} tone="red"><MailX className="mr-1 h-3 w-3" />{label}: se dio de baja</Badge>
                  : k?.optIn ? <Badge key={ch} tone="green"><MessageCircle className="mr-1 h-3 w-3" />{label}: con permiso</Badge>
                  : <Badge key={ch} tone="gray">{label}: sin permiso</Badge>;
              })}
            </div>
            {canManage && (c.email || c.phone) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
                <span className="text-xs text-muted">¿Dato malo? Márcalo y nadie (ni la cadencia) lo vuelve a usar:</span>
                {c.email && <ChannelInvalidButton id={c.id} channel="email" invalid={!!c.emailInvalidAt} />}
                {c.phone && <ChannelInvalidButton id={c.id} channel="phone" invalid={!!c.phoneInvalidAt} />}
              </div>
            )}
            {c.notes && <p className="px-5 pb-5 text-sm text-muted">{c.notes}</p>}
          </Card>

          {canManage && (
            <Card>
              <PanelHeader title="Estado" subtitle="Normalmente el estado avanza solo (toques, demos, la app). Aquí se corrige a mano o se marca perdido." />
              <div className="px-5 pb-5"><LeadStatusForm id={c.id} status={c.leadStatus} /></div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {canManage && (
            <Card>
              <PanelHeader title="Nota" />
              <div className="px-5 pb-5"><NoteForm id={c.id} /></div>
            </Card>
          )}
          <Card>
            <PanelHeader title="Historial" subtitle={`${timeline.length} evento(s)`} />
            <div className="px-5 pb-3"><Timeline items={timeline} /></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
