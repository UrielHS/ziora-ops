import Link from "next/link";
import { desc, eq, ne } from "drizzle-orm";
import { ExternalLink, Lightbulb } from "lucide-react";
import { createSuggestion, decideSuggestion } from "@/actions/content";
import { Avatar, Badge, btn, Card, Empty, Field, inputCls, PageHeader, PanelHeader, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { contentSuggestions } from "@/db/schema";
import { users } from "@/db/shared";
import { relative } from "@/lib/format";
import { CONTENT_CHANNEL, CONTENT_PILLAR, SUGGESTION_STATUS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requireAccess } from "@/lib/session";
import { DeleteButton } from "@/components/ui/delete-button";

export const dynamic = "force-dynamic";

type Suggestion = typeof contentSuggestions.$inferSelect;

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<{ nueva?: string }> }) {
  const sp = await searchParams;
  const access = await requireAccess();
  const canDecide = can(access, "suggestions.decide");
  const [pending, decided, people] = await Promise.all([
    db.select().from(contentSuggestions).where(eq(contentSuggestions.status, "new")).orderBy(desc(contentSuggestions.createdAt)),
    db.select().from(contentSuggestions).where(ne(contentSuggestions.status, "new")).orderBy(desc(contentSuggestions.updatedAt)).limit(40),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing"
        title="Sugerencias de contenido"
        subtitle="Ideas del equipo para redes. No son tareas: marketing las revisa y, si pasan, se vuelven pieza y tarea de publicación."
        actions={<>
          <Link href="/content" className={btn("ghost")}>← Calendario</Link>
          {can(access, "content.suggest") && <NewSuggestion defaultOpen={sp.nueva === "1"} />}
        </>}
      />

      <Card>
        <PanelHeader title={`Por revisar (${pending.length})`} subtitle={canDecide ? "Acepta o descarta. Al descartar, explica brevemente por qué." : "Marketing las revisará pronto."} />
        <div className="grid gap-3 p-5 md:grid-cols-2">
          {pending.length === 0 && <div className="md:col-span-2"><Empty title="Sin sugerencias nuevas" text="¿Viste algo en consulta o con un cliente que daría para un post? Sugiérelo." /></div>}
          {pending.map((s) => (
            <SuggestionCard key={s.id} s={s} author={name(s.authorId)}>
              {canDecide && (
                <div className="flex gap-2 pt-1">
                  <Modal trigger="Aceptar" title="Aceptar sugerencia" triggerClass={btn("primary", "sm")}>
                    <ActionForm action={decideSuggestion}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="decision" value="accepted" />
                      <p className="text-sm text-muted">Se creará la pieza &quot;{s.title}&quot; en el calendario y una tarea de publicación asignada a ti.</p>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Pilar"><Select name="pillar" defaultValue="psicoterapia_moderna" options={Object.entries(CONTENT_PILLAR).map(([k, v]) => [k, v.label])} /></Field>
                        <Field label="Canal"><Select name="channel" defaultValue={s.channel ?? "instagram"} options={Object.entries(CONTENT_CHANNEL)} /></Field>
                        <Field label="Formato"><Select name="format" defaultValue="carrusel" options={[["carrusel", "Carrusel"], ["reel", "Reel"], ["imagen", "Imagen"], ["video", "Video"], ["historia", "Historia"], ["post", "Post"]]} /></Field>
                        <Field label="Fecha tentativa"><input type="date" name="publishOn" className={inputCls} /></Field>
                      </div>
                      <Field label="Nota para quien sugirió (opcional)"><textarea name="note" rows={2} className={inputCls} /></Field>
                      <Submit>Aceptar y crear pieza</Submit>
                    </ActionForm>
                  </Modal>
                  <Modal trigger="Descartar" title="Descartar sugerencia" triggerClass={btn("ghost", "sm")}>
                    <ActionForm action={decideSuggestion}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="decision" value="rejected" />
                      <Field label="¿Por qué no se usará?"><textarea name="note" rows={3} required className={inputCls} placeholder="Ej. Riesgo legal: habla de diagnóstico." /></Field>
                      <Submit variant="danger">Descartar</Submit>
                    </ActionForm>
                  </Modal>
                  <DeleteButton kind="suggestion" id={s.id} what={`la sugerencia "${s.title}"`} className="ml-auto" />
                </div>
              )}
            </SuggestionCard>
          ))}
        </div>
      </Card>

      {decided.length > 0 && (
        <Card>
          <PanelHeader title="Historial" />
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {decided.map((s) => (
              <SuggestionCard key={s.id} s={s} author={name(s.authorId)}>
                {s.decisionNote && <p className="text-xs text-muted"><b>{name(s.decidedBy)}:</b> {s.decisionNote}</p>}
                {s.status === "accepted" && <Link href="/content" className="text-xs font-semibold text-emerald">Ver en el calendario ↗</Link>}
                {canDecide && <DeleteButton kind="suggestion" id={s.id} what={`la sugerencia "${s.title}"`} warning={s.status === "accepted" ? "La pieza y la tarea que se crearon con ella se quedan." : undefined} />}
              </SuggestionCard>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function SuggestionCard({ s, author, children }: { s: Suggestion; author: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold leading-snug">{s.title}</p>
        <Badge tone={SUGGESTION_STATUS[s.status].tone}>{SUGGESTION_STATUS[s.status].label}</Badge>
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted">{s.idea}</p>
      {s.why && <p className="text-xs text-muted"><b>Por qué:</b> {s.why}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
        <Avatar name={author} size={20} /> {author} · {relative(s.createdAt)}
        {s.channel && <Badge tone="gray">{CONTENT_CHANNEL[s.channel]}</Badge>}
        {s.referenceUrl && <a href={s.referenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald">Referencia <ExternalLink className="h-3 w-3" /></a>}
      </div>
      {children}
    </div>
  );
}

function NewSuggestion({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <Modal trigger={<><Lightbulb className="h-4 w-4" /> Sugerir idea</>} title="Sugerir contenido" defaultOpen={defaultOpen}>
      <ActionForm action={createSuggestion}>
        <Field label="Título o gancho"><input name="title" required className={inputCls} placeholder="Lo que nadie te dice de la primera sesión" /></Field>
        <Field label="La idea" hint="¿De qué trata? ¿Qué debería aprender o sentir quien lo vea?"><textarea name="idea" rows={4} required className={inputCls} /></Field>
        <Field label="¿Por qué ahora? (opcional)" hint="Ej. Me lo preguntaron 3 clínicas esta semana."><textarea name="why" rows={2} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Red sugerida"><Select name="channel" placeholder="Cualquiera" options={Object.entries(CONTENT_CHANNEL)} /></Field>
          <Field label="Referencia (opcional)"><input name="referenceUrl" type="url" className={inputCls} placeholder="https://" /></Field>
        </div>
        <p className="rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn">Sin datos, casos ni frases de pacientes, aunque estén anonimizados.</p>
        <Submit>Enviar sugerencia</Submit>
      </ActionForm>
    </Modal>
  );
}
