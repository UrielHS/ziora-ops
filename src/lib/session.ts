import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/db";
import { memberRoles } from "@/db/schema";
import { users } from "@/db/shared";
import { isAllowedEmail } from "@/lib/access";
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
  // Segunda barrera además del signIn de Google: una sesión vieja de un correo ajeno tampoco pasa.
  if (!isAllowedEmail(email)) redirect("/login?error=AccessDenied");
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
  // La entrada la decide el dominio del correo (isAllowedEmail). Los roles solo deciden qué ve y qué puede hacer;
  // sin rol se entra igual y el layout muestra el aviso para pedir uno.
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
