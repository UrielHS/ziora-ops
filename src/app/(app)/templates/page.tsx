import Link from "next/link";
import { desc } from "drizzle-orm";
import { btn, Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { renderTemplate } from "@/domain/template";
import { relative } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requirePagePermission("content.manage");
  const rows = await db.select().from(emailTemplates).orderBy(desc(emailTemplates.updatedAt));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Marketing" title="Plantillas de correo" subtitle="HTML con variables y vista previa en vivo. Todas llevan enlace de baja." actions={<Link href="/templates/new" className={btn()}>+ Plantilla</Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((t) => (
          <Link key={t.id} href={`/templates/${t.id}`} className="card overflow-hidden hover:border-emerald/40">
            <div className="pointer-events-none h-48 overflow-hidden border-b border-line bg-[#F3F1EA]">
              <iframe title={t.name} sandbox="" srcDoc={renderTemplate(t.html, { nombre: "Andrea", evento: "Demo Night", baja: "#" })} className="h-[720px] w-[200%] origin-top-left scale-50 border-0" />
            </div>
            <div className="p-4">
              <p className="font-bold">{t.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted">{t.subject}</p>
              <p className="mt-2 text-[11px] text-faint">Editada {relative(t.updatedAt)}</p>
            </div>
          </Link>
        ))}
        {rows.length === 0 && <Card className="p-6 text-sm text-muted">Aún no hay plantillas.</Card>}
      </div>
    </div>
  );
}
