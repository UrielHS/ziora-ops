import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/shared";
import { isAllowedEmail } from "@/lib/access";

// Dos condiciones para entrar: correo del equipo (@ziora-copilot.com) y estar activo en public.users (la lista de Event Ops).
// Aquí nunca se crean ni escalan cuentas.
// En desarrollo, si no hay AUTH_SECRET, usa uno fijo para que la app arranque sin configurar nada.
// En producción no hay respaldo: Auth.js falla si falta el secreto, que es lo correcto.
const secret = process.env.AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "solo-desarrollo-ziora-ops-no-usar-en-produccion" : undefined);

// Las cookies no distinguen puertos: en localhost, Event Ops (:3000) y Ziora Ops (:3001) compartirían
// "authjs.session-token" con secretos distintos ("no matching decryption secret"). En desarrollo usamos un nombre propio.
const devCookies = process.env.NODE_ENV !== "production"
  ? { sessionToken: { name: "ziora-ops.session-token" } }
  : undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret,
  cookies: devCookies,
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ user, profile }) {
      if (profile && profile.email_verified === false) return false;
      const email = user.email?.toLowerCase();
      if (!email || !isAllowedEmail(email)) return false;
      try {
        const rows = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email), eq(users.active, true)))
          .limit(1);
        return rows.length === 1;
      } catch (err) {
        console.error("signIn: error de base de datos", err);
        return false;
      }
    },
  },
});
