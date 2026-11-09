import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TemplateEditor } from "@/components/template-editor";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { DeleteButton } from "@/components/ui/delete-button";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("content.manage");
  const { id } = await params;
  if (id === "new") {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Plantillas" title="Nueva plantilla" actions={<Link href="/templates" className="text-sm text-muted underline">Volver</Link>} />
        <TemplateEditor />
      </div>
    );
  }
  if (!z.uuid().safeParse(id).success) notFound();
  const [t] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
  if (!t) notFound();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Plantillas" title={t.name} actions={<>
        <DeleteButton kind="template" id={t.id} what={`la plantilla "${t.name}"`} redirectTo="/templates" label="Eliminar plantilla" />
        <Link href="/templates" className="text-sm text-muted underline">Volver</Link>
      </>} />
      <TemplateEditor t={t} />
    </div>
  );
}
