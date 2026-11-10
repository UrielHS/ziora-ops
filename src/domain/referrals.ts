/**
 * Referidos por vendedor: cuántos terapeutas se registraron en la app con el código de
 * referido de cada vendedor (perfil con liga /r/<código>) y cuántos de ellos pagan.
 * La app manda `referredByCode` en el snapshot; mientras no lo mande, no hay nada que contar.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Dbx } from "@/db";
import { appUsers, planPrices, sellerProfiles } from "@/db/schema";
import { users } from "@/db/shared";
import { isPaying } from "./app-users";
import { referralCodeFrom } from "./sellers";

export type SellerReferrals = { userId: string; name: string; code: string; signups: number; paying: number };

/** Un renglón por vendedor con código en su perfil; cuentas de prueba y bajas no cuentan. */
export async function referralsBySeller(db: Dbx): Promise<SellerReferrals[]> {
  const [profiles, referred, prices] = await Promise.all([
    db.select({ userId: sellerProfiles.userId, name: users.name, referralUrl: sellerProfiles.referralUrl }).from(sellerProfiles).innerJoin(users, eq(users.id, sellerProfiles.userId)),
    db.select({ code: appUsers.referredByCode, plan: appUsers.plan, status: appUsers.status, mrrCents: appUsers.mrrCents, currency: appUsers.currency })
      .from(appUsers).where(and(isNotNull(appUsers.referredByCode), isNull(appUsers.removedAt), eq(appUsers.isTest, false))),
    db.select().from(planPrices),
  ]);
  const out: SellerReferrals[] = [];
  for (const p of profiles) {
    const code = referralCodeFrom(p.referralUrl);
    if (!code) continue;
    const mine = referred.filter((r) => (r.code ?? "").toUpperCase() === code);
    out.push({ userId: p.userId, name: p.name, code, signups: mine.length, paying: mine.filter((r) => isPaying(r, prices)).length });
  }
  return out.sort((a, b) => b.signups - a.signups || a.name.localeCompare(b.name));
}

/** ¿La app ya manda el código de referido? (hay al menos un usuario con `referred_by_code`). */
export async function appReportsReferrals(db: Dbx): Promise<boolean> {
  const [row] = await db.select({ uid: appUsers.uid }).from(appUsers).where(isNotNull(appUsers.referredByCode)).limit(1);
  return !!row;
}
