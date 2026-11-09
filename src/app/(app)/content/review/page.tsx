import Link from "next/link";
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { CheckCircle2, CircleDashed, ExternalLink, MessageSquareWarning } from "lucide-react";
import { reviewPiece } from "@/actions/content";
import { channelsOf, pillarColor, ReviewBadges } from "@/components/content";
import { Badge, btn, Card, cn, Empty, Field, inputCls, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { reviewsForPieces, type PieceReview } from "@/db/content-review";
import { contentPieces } from "@/db/schema";
import { users } from "@/db/shared";
import { fmtDate, relative } from "@/lib/format";
import { CONTENT_CHANNEL, CONTENT_PILLAR, OPS_ROLE } from "@/lib/labels";
import { can, CONTENT_REVIEWER_ROLES } from "@/lib/permissions";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

type Piece = typeof contentPieces.$inferSelect;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const sp = await searchParams;
  const access = await requireAccess();
  const canReview = can(access, "content.review");
  const [candidates, returned] = await Promise.all([
    // En revisión, y programadas que todavía no están aprobadas.
    db.select().from(contentPieces)
      .where(or(eq(contentPieces.status, "legal_review"), and(eq(contentPieces.status, "scheduled"), isNotNull(contentPieces.reviewRequestedAt))))
      .orderBy(asc(contentPieces.publishOn)),
    db.select().from(contentPieces).where(inArray(contentPieces.status, ["draft"])).orderBy(desc(contentPieces.updatedAt)).limit(30),
  ]);
  const reviews = await reviewsForPieces(db, [...candidates, ...returned].map((p) => p.id));
  const inReview = candidates.filter((p) => p.status === "legal_review" || !reviews.get(p.id)?.complete);
  const returnedWithChanges = returned.filter((p) => reviews.get(p.id)?.changesRequested);
  const owners = await db.select({ id: users.id, name: users.name }).from(users);
  const ownerName = (id: string | null) => owners.find((o) => o.id === id)?.name ?? "Sin responsable";

  const mine = inReview.filter((p) => {
    const mineReview = reviews.get(p.id)?.reviews.find((r) => r.reviewerId === access.user.id);
    return mineReview?.decision !== "approved";
  });
  const showAll = sp.ver === "todas" || !canReview;
  const list = showAll ? inReview : mine;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing"
        title="Revisión de contenido"
        subtitle="Cada pieza necesita la aprobación del director clínico (o del CEO si él no puede) y la checklist legal completa antes de aprobarse o publicarse. Se puede programar antes: se ve como «Sin revisar»."
        actions={<Link href="/content" className={btn("ghost")}>← Calendario</Link>}
      />

      {canReview && (
        <div className="flex gap-1.5">
          <Link href="/content/review" className={cn(btn(showAll ? "ghost" : "secondary", "sm"))}>Pendientes de mi revisión ({mine.length})</Link>
          <Link href="/content/review?ver=todas" className={cn(btn(showAll ? "secondary" : "ghost", "sm"))}>Todas en revisión ({inReview.length})</Link>
        </div>
      )}

      {list.length === 0 ? (
        <Empty title={showAll ? "Nada en revisión" : "Estás al día"} text={showAll ? "Cuando marketing envíe una pieza a revisión aparecerá aquí." : "No tienes piezas pendientes de revisar."} />
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((p) => <ReviewCard key={p.id} p={p} review={reviews.get(p.id)!} owner={ownerName(p.ownerId)} canReview={canReview} myId={access.user.id} />)}
        </div>
      )}

      {returnedWithChanges.length > 0 && (
        <Card className="p-5">
          <p className="label mb-3">Regresadas a borrador con cambios pedidos</p>
          <div className="flex flex-col gap-2">
            {returnedWithChanges.map((p) => (
              <div key={p.id} className="flex flex-col gap-1 rounded-xl border border-line bg-white px-3 py-2 text-sm">
                <span className="font-semibold">{p.title} <span className="font-normal text-faint">· {ownerName(p.ownerId)}</span></span>
                {reviews.get(p.id)!.reviews.filter((r) => r.decision === "changes_requested").map((r) => (
                  <span key={r.reviewerId} className="text-xs text-muted"><b>{r.reviewerName}:</b> {r.comment}</span>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ReviewCard({ p, review, owner, canReview, myId }: { p: Piece; review: PieceReview; owner: string; canReview: boolean; myId: string }) {
  const mine = review.reviews.find((r) => r.reviewerId === myId);
  return (
    <Card className="overflow-hidden" >
      <div id={p.id} className="grid gap-0 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: pillarColor(p.pillar) }} />
            <span className="text-xs text-muted">{CONTENT_PILLAR[p.pillar].label} · {channelsOf(p).map((c) => CONTENT_CHANNEL[c]).join(", ")} · {p.format}{p.status === "scheduled" && " · Programada"}</span>
            <Badge tone="gray">{p.publishOn ? `Sale ${fmtDate(p.publishOn)}` : "Sin fecha"}</Badge>
            {p.risk !== "low" && <Badge tone={p.risk === "high" ? "red" : "amber"}>Riesgo {p.risk === "high" ? "alto" : "medio"}</Badge>}
            {!p.legalChecklistOk && <Badge tone="gray">Checklist legal pendiente</Badge>}
          </div>
          <h2 className="text-lg font-bold leading-snug">{p.title}</h2>
          <p className="text-xs text-faint">Responsable: {owner}</p>
          {p.copy ? <p className="whitespace-pre-wrap rounded-2xl bg-[#F7F6F0] p-4 text-sm leading-relaxed">{p.copy}</p> : <p className="text-sm text-faint">Sin copy todavía.</p>}
          <div className="flex flex-wrap gap-2">
            {p.assetUrl && <a href={p.assetUrl} target="_blank" rel="noreferrer" className={btn("secondary", "sm")}>Ver diseño o video <ExternalLink className="h-3 w-3" /></a>}
            {p.sources.map((s) => <span key={s} className="rounded-full bg-[#F1F0EA] px-2.5 py-1 text-[11px] text-muted">{s}</span>)}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-line bg-[#FAF9F5] p-5 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between"><p className="label">Revisores</p><ReviewBadges review={review} /></div>
          <div className="flex flex-col gap-1.5">
            {CONTENT_REVIEWER_ROLES.map((role) => {
              const ok = review.approvedRoles.includes(role);
              return (
                <span key={role} className="flex items-center gap-2 text-sm">
                  {ok ? <CheckCircle2 className="h-4 w-4 text-emerald" /> : <CircleDashed className="h-4 w-4 text-faint" />}
                  {OPS_ROLE[role].label}{role === "ceo" ? " (opcional; sustituye al director clínico)" : " (obligatoria)"}
                </span>
              );
            })}
          </div>
          {review.reviews.filter((r) => r.comment).map((r) => (
            <p key={r.reviewerId} className={cn("rounded-xl px-3 py-2 text-xs", r.decision === "approved" ? "bg-mint text-emerald" : "bg-danger-bg text-danger")}>
              {r.decision === "changes_requested" && <MessageSquareWarning className="mr-1 inline h-3.5 w-3.5" />}
              <b>{r.reviewerName}</b> · {relative(r.updatedAt)}: {r.comment}
            </p>
          ))}
          {canReview && (
            <ActionForm action={reviewPiece} className="flex flex-col gap-2 border-t border-line pt-3">
              <input type="hidden" name="pieceId" value={p.id} />
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5"><input type="radio" name="decision" value="approved" defaultChecked={mine?.decision !== "changes_requested"} className="accent-[#059669]" /> Aprobar</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="decision" value="changes_requested" defaultChecked={mine?.decision === "changes_requested"} className="accent-[#B42318]" /> Pedir cambios</label>
              </div>
              <Field label="Comentario" hint="Obligatorio si pides cambios.">
                <textarea name="comment" rows={2} className={inputCls} placeholder="Ej. Cambiar &quot;detecta&quot; por &quot;te ayuda a notar&quot;" />
              </Field>
              <Submit>{mine ? "Actualizar mi revisión" : "Enviar revisión"}</Submit>
            </ActionForm>
          )}
        </div>
      </div>
    </Card>
  );
}
