import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/db";
import { memberRoles } from "@/db/schema";
import { users } from "@/db/shared";
import { can, type Access, type Permission } from "@/lib/permissions";

export type SessionUser = typeof users.$inferSelect;
export type SessionAccess = Access & { user: SessionUser };

/** Correo con el que se entra sin Google. Solo en desarrollo; en producción siempre es null. */
export function devLoginEmail(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return process.env.DEV_LOGIN_EMAIL?.toLowerCase() ?? null;
}

export const requireUser = cache(async (): Promise<SessionUser> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() ?? devLoginEmail();
  if (!email) redirect("/login");
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.active) redirect("/login?error=AccessDenied");
  return user;
});

/** Persona en sesión con sus roles de Ziora Ops. */
export const requireAccess = cache(async (): Promise<SessionAccess> => {
  const user = await requireUser();
  const rows = await db.select({ role: memberRoles.role }).from(memberRoles).where(eq(memberRoles.userId, user.id));
  const isAdmin = user.role === "admin";
  const roles = rows.map((r) => r.role);
  // Entrar a Event Ops no basta: aquí hay datos de leads. Sin rol en Ziora Ops (o admin) no se entra.
  if (!isAdmin && roles.length === 0) redirect("/login?error=SinRol");
  return { user, isAdmin, roles };
});

/** Para server actions: falla con un mensaje claro si la persona no tiene el permiso. */
export async function requirePermission(permission: Permission): Promise<SessionAccess> {
  const access = await requireAccess();
  if (!can(access, permission)) throw new Error("Tu rol no tiene permiso para esta acción.");
  return access;
}

/** Para páginas: manda al dashboard si la persona no tiene el permiso. */
export async function requirePagePermission(permission: Permission): Promise<SessionAccess> {
  const access = await requireAccess();
  if (!can(access, permission)) redirect("/dashboard?sinPermiso=1");
  return access;
}
