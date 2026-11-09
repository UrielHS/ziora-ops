import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { btn, inputCls } from "@/components/ui";
import { navCounts } from "@/db/queries";
import { OPS_ROLE } from "@/lib/labels";
import { requireAccess } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ user, isAdmin, roles }, counts] = await Promise.all([requireAccess(), navCounts()]);
  const roleLabel = roles.length ? roles.map((r) => OPS_ROLE[r].label).join(" · ") : isAdmin ? "Admin" : "Sin rol asignado";
  return (
    <div className="flex min-h-screen">
      <Sidebar user={{ name: user.name, roleLabel }} counts={counts} access={{ isAdmin, roles }} />
      <div className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8">
        <div className="mb-5 flex items-center gap-3">
          <form action="/search" className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input name="q" placeholder="Buscar tareas, contactos, demos, bugs…" className={`${inputCls} rounded-full pl-9`} />
          </form>
          <details className="relative ml-auto">
            <summary className={`${btn("primary")} list-none`}>
              <Plus className="h-4 w-4" /> Nuevo
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-2xl border border-line bg-white py-1 shadow-lg">
              {[
                ["/tasks?nuevo=1", "Tarea"], ["/demos?nuevo=1", "Demo"], ["/sales?nueva=1", "Oportunidad B2B"], ["/followups?nuevo=1", "Seguimiento 1:1"], ["/tickets?nuevo=1", "Ticket (cambio o idea)"], ["/bugs?nuevo=1", "Bug"],
                ["/contacts?nuevo=1", "Contacto"], ["/content?nuevo=1", "Pieza de contenido"], ["/content/suggestions?nueva=1", "Sugerencia de contenido"], ["/campaigns/new", "Campaña"],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="block px-4 py-2 text-sm hover:bg-mint">{label}</Link>
              ))}
            </div>
          </details>
        </div>
        {!isAdmin && roles.length === 0 && (
          <p className="mb-4 rounded-2xl border border-warn/30 bg-warn-bg px-4 py-2.5 text-sm text-warn">
            Todavía no tienes un rol en Ziora Ops. Pide a Chris o a Pau que te lo asignen en Ajustes → Equipo.
          </p>
        )}
        {children}
      </div>
      <MobileNav counts={counts} access={{ isAdmin, roles }} />
    </div>
  );
}
