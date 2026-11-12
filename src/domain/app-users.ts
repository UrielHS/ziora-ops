/**
 * Usuarios de Ziora Copilot (la app clínica, servida por ziora-api), vistos desde Ziora Ops.
 * El contrato del snapshot es estricto: si la app manda un campo no permitido (por ejemplo,
 * algo de un paciente), la sincronización completa se rechaza. Ver docs/API-ZIORA-APP.md.
 */
import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { appUserDaily, appUsers, planPrices } from "@/db/schema";
import { resolveAttribution } from "./community-leads";
import { monthlyValue, type BillingPeriod } from "./sales";

export const SnapshotUser = z.strictObject({
  uid: z.string().min(1).max(128),
  email: z.email(),
  name: z.string().max(200).nullable().optional(),
  plan: z.string().min(1).max(40),
  status: z.string().min(1).max(40),
  createdAt: z.iso.datetime({ offset: true }).nullable().optional(),
  lastActiveAt: z.iso.datetime({ offset: true }).nullable().optional(),
  trialEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  patientCount: z.number().int().min(0),
  sessionsLast30d: z.number().int().min(0).default(0),
  // Suscripción (opcionales: la app puede mandarlos o no)
  billingPeriod: z.enum(["monthly", "semiannual", "annual"]).nullable().optional(),
  mrrAmount: z.number().min(0).max(10_000_000).nullable().optional(),
  currency: z.string().regex(/^[a-z]{3}$/).nullable().optional(),
  currentPeriodEnd: z.iso.datetime({ offset: true }).nullable().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  // Código de referido con el que se registró (la app lo manda desde nov-2026; versiones viejas no)
  referredByCode: z.string().max(32).nullable().optional(),
  // Snapshot v2 (Ops manda "v": 2): atribución de registro y señales de uso. Todo opcional para seguir aceptando v1.
  attribution: z.strictObject({
    utm_source: z.string().max(200).optional(), utm_medium: z.string().max(200).optional(), utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(), utm_term: z.string().max(200).optional(),
    gclid: z.string().max(200).optional(), fbclid: z.string().max(200).optional(), ref: z.string().max(200).optional(),
  }).nullable().optional(),
  trialKind: z.string().max(16).nullable().optional(),
  hasPaidInvoice: z.boolean().optional(),
  feedbackCount: z.number().int().min(0).optional(),
  sessionsTotal: z.number().int().min(0).optional(),
  notesTotal: z.number().int().min(0).optional(),
});
export const Snapshot = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  users: z.array(SnapshotUser).max(200_000),
});
export type SnapshotUser = z.infer<typeof SnapshotUser>;
export type Snapshot = z.infer<typeof Snapshot>;

export const ACTIVE_DAYS = 14;
const DAY = 86_400_000;

export function isActive(lastActiveAt: Date | null, now: Date, days = ACTIVE_DAYS) {
  return !!lastActiveAt && now.getTime() - lastActiveAt.getTime() <= days * DAY;
}

type Price = { plan: string; priceMxn: number; billingPeriod: BillingPeriod; paying: boolean };
type Billing = { mrrCents?: number | null; currency?: string | null };
type UserLike = { plan: string; status: string; lastActiveAt: Date | null; patientCount: number; removedAt?: Date | null } & Billing;

// No cuentan como de pago: cancelada, inactiva, con pago fallido (Stripe: unpaid, incomplete, incomplete_expired)
// o sin suscripción ("free", aunque el plan sea Pro otorgado a mano).
const CANCELLED = /cancel|inactive|deleted|expired|unpaid|incomplete|^free$/i;

/** MRR real en pesos que mandó la app (Stripe), o null si no lo mandó o viene en otra moneda. */
export function realMrr(u: Billing): number | null {
  if (u.mrrCents == null) return null;
  if (u.currency && u.currency !== "mxn") return null;
  return u.mrrCents / 100;
}

type PayLike = Pick<UserLike, "plan" | "status"> & Billing;

/** Cuenta que paga: estado no cancelado ni en prueba y, con dato real, monto > 0; si no, plan marcado como de pago. */
export function isPaying(u: PayLike, prices: Price[]) {
  if (CANCELLED.test(u.status) || /trial/i.test(u.status)) return false;
  const real = realMrr(u);
  if (real !== null) return real > 0;
  return !!prices.find((x) => x.plan === u.plan)?.paying;
}

/** MRR: el monto real de cada cuenta cuando la app lo manda; si no, plan × precio. */
export function estimatedMrr(users: PayLike[], prices: Price[]) {
  return users.reduce((sum, u) => {
    if (!isPaying(u, prices)) return sum;
    const real = realMrr(u);
    if (real !== null) return sum + real;
    const p = prices.find((x) => x.plan === u.plan);
    return p ? sum + monthlyValue(p.priceMxn, p.billingPeriod) : sum;
  }, 0);
}

export function summarizeByPlan(users: UserLike[], prices: Price[], now: Date) {
  const plans = [...new Set(users.map((u) => u.plan))].sort();
  return plans.map((plan) => {
    const us = users.filter((u) => u.plan === plan);
    return {
      plan,
      users: us.length,
      active: us.filter((u) => isActive(u.lastActiveAt, now)).length,
      paying: us.filter((u) => isPaying(u, prices)).length,
      patients: us.reduce((s, u) => s + u.patientCount, 0),
      estimatedMrrMxn: Math.round(estimatedMrr(us, prices)),
    };
  });
}

/** Cómo paga hoy una cuenta, según lo que mandó la app desde Stripe. */
export type PayState = "paying" | "courtesy" | "trial" | "cancelled" | "none";

/**
 * paying = factura pagada > 0 (o plan de pago sin dato real); courtesy = suscripción activa que paga 0
 * (cupón del 100 %, Pro otorgado a mano); trial = en prueba; cancelled = cancelada o con pago fallido;
 * none = sin suscripción (plan gratis o Pro sin Stripe).
 */
export function payState(u: PayLike, prices: Price[]): PayState {
  if (/trial/i.test(u.status)) return "trial";
  if (u.status === "free") return "none";
  if (CANCELLED.test(u.status)) return "cancelled";
  if (isPaying(u, prices)) return "paying";
  return realMrr(u) === 0 ? "courtesy" : "none";
}

// Dominios de correo desechable vistos en registros de prueba.
const DISPOSABLE_DOMAINS = new Set(["ebflyai.com", "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "tempmail.com", "sharklasers.com"]);
const INTERNAL_DOMAIN = "ziora-copilot.com";
// Alias con "+" que el equipo usa para probar: +test, +dev, +qa, +demo, +prueba, +staging, +t1, +l2, +j2, +dev12…
const TEST_PLUS_TAG = /\+(test|dev|qa|demo|prueba|staging|stg|tmp|[a-z]{1,2}\d{1,3})(\d*)?([._-]|$)/i;

/** Cuenta que huele a prueba o interna: dominio de Ziora, correo desechable o alias "+test"-style. */
export function looksLikeTestAccount(email: string) {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return false;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === INTERNAL_DOMAIN || domain.endsWith(`.${INTERNAL_DOMAIN}`)) return true;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  return TEST_PLUS_TAG.test(local);
}

export type FollowupReason = "paying_inactive" | "trial_ending";

/** A quién conviene llamar: clientes de pago sin entrar 7+ días y trials que vencen en 4 días o menos. */
export function followupCandidates<T extends UserLike & { trialEndsAt: Date | null }>(users: T[], prices: Price[], now: Date) {
  const out: { user: T; reason: FollowupReason }[] = [];
  for (const u of users) {
    if (u.removedAt) continue;
    if (isPaying(u, prices) && !isActive(u.lastActiveAt, now, 7)) out.push({ user: u, reason: "paying_inactive" });
    else if (/trial/i.test(u.status) && u.trialEndsAt && u.trialEndsAt.getTime() >= now.getTime() && u.trialEndsAt.getTime() - now.getTime() <= 4 * DAY) {
      out.push({ user: u, reason: "trial_ending" });
    }
  }
  return out;
}

const mxDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);

/** Marca o desmarca una cuenta como de prueba. Se conserva entre sincronizaciones. */
export async function setAppUserTest(db: Db, uid: string, isTest: boolean) {
  await db.update(appUsers).set({ isTest }).where(eq(appUsers.uid, uid));
}

/** Liga a su comunidad y post (por utm_term, o utm_content) a quien tiene atribución y aún no está ligado. */
export async function linkCommunities(db: Db) {
  const pending = await db.select({ uid: appUsers.uid, attribution: appUsers.attribution }).from(appUsers)
    .where(and(isNull(appUsers.communityId), isNotNull(appUsers.attribution), sql`${appUsers.attribution} <> '{}'::jsonb`));
  const cache = new Map<string, Awaited<ReturnType<typeof resolveAttribution>>>();
  for (const p of pending) {
    if (p.attribution.utm_medium !== "comunidad") continue;
    const key = `${p.attribution.utm_term ?? ""}|${p.attribution.utm_content ?? ""}`;
    let r = cache.get(key);
    if (!r) { r = await resolveAttribution(db, p.attribution); cache.set(key, r); }
    if (r.communityId) await db.update(appUsers).set({ communityId: r.communityId, communityPostId: r.postId }).where(eq(appUsers.uid, p.uid));
  }
}

/** Aplica un snapshot completo: upsert, marca bajas y guarda la foto diaria por plan. */
export async function applySnapshot(db: Db, snap: Snapshot, now = new Date()) {
  const toDate = (s?: string | null) => (s ? new Date(s) : null);
  const rows = snap.users.map((u) => ({
    uid: u.uid, email: u.email.toLowerCase(), name: u.name ?? null, plan: u.plan, status: u.status,
    signedUpAt: toDate(u.createdAt), lastActiveAt: toDate(u.lastActiveAt), trialEndsAt: toDate(u.trialEndsAt),
    patientCount: u.patientCount, sessionsLast30d: u.sessionsLast30d,
    billingPeriod: u.billingPeriod ?? null, mrrCents: u.mrrAmount == null ? null : Math.round(u.mrrAmount * 100),
    currency: u.currency ?? null, currentPeriodEnd: toDate(u.currentPeriodEnd), cancelAtPeriodEnd: u.cancelAtPeriodEnd ?? false,
    referredByCode: u.referredByCode ?? null,
    attribution: (u.attribution ?? {}) as Record<string, string>, trialKind: u.trialKind ?? null,
    hasPaidInvoice: u.hasPaidInvoice ?? null,
    feedbackCount: u.feedbackCount ?? 0, sessionsTotal: u.sessionsTotal ?? 0, notesTotal: u.notesTotal ?? 0,
    isTest: looksLikeTestAccount(u.email),
    syncedAt: now, removedAt: null,
  }));

  // Los contadores solo se pisan si la app mandó v2; con un snapshot v1 se conservan los que había.
  const v2 = snap.users.some((u) => u.sessionsTotal !== undefined || u.notesTotal !== undefined || u.feedbackCount !== undefined);
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(appUsers).values(rows.slice(i, i + 500)).onConflictDoUpdate({
        target: appUsers.uid,
        set: {
          email: sql`excluded.email`, name: sql`excluded.name`, plan: sql`excluded.plan`, status: sql`excluded.status`,
          signedUpAt: sql`excluded.signed_up_at`, lastActiveAt: sql`excluded.last_active_at`, trialEndsAt: sql`excluded.trial_ends_at`,
          patientCount: sql`excluded.patient_count`, sessionsLast30d: sql`excluded.sessions_last_30d`,
          billingPeriod: sql`excluded.billing_period`, mrrCents: sql`excluded.mrr_cents`, currency: sql`excluded.currency`,
          currentPeriodEnd: sql`excluded.current_period_end`, cancelAtPeriodEnd: sql`excluded.cancel_at_period_end`,
          // La atribución es permanente en la app: si el snapshot no trae código (o trae null), se conserva el que había.
          referredByCode: sql`coalesce(excluded.referred_by_code, app_users.referred_by_code)`,
          // Atribución y tipo de prueba también son permanentes: vacío o null no borran lo guardado.
          attribution: sql`case when excluded.attribution = '{}'::jsonb then app_users.attribution else excluded.attribution end`,
          trialKind: sql`coalesce(excluded.trial_kind, app_users.trial_kind)`,
          hasPaidInvoice: sql`coalesce(excluded.has_paid_invoice, app_users.has_paid_invoice)`,
          ...(v2 ? { feedbackCount: sql`excluded.feedback_count`, sessionsTotal: sql`excluded.sessions_total`, notesTotal: sql`excluded.notes_total` } : {}),
          // La marca de prueba solo sube: la pone el equipo o la detección por correo, y nadie la quita al sincronizar.
          isTest: sql`app_users.is_test or excluded.is_test`,
          syncedAt: sql`excluded.synced_at`, removedAt: sql`null`,
        },
      });
    }
    // Un snapshot vacío casi siempre es un error de la función, no "todos se fueron".
    if (rows.length > 0) {
      await tx.update(appUsers).set({ removedAt: now })
        .where(and(isNull(appUsers.removedAt), notInArray(appUsers.uid, rows.map((r) => r.uid))));
    }
  });

  await linkCommunities(db);

  const prices = await db.select().from(planPrices);
  const current = await db.select().from(appUsers).where(and(isNull(appUsers.removedAt), eq(appUsers.isTest, false)));
  const day = mxDay(now);
  const summary = summarizeByPlan(current, prices, now);
  for (const s of summary) {
    await db.insert(appUserDaily).values({ day, ...s })
      .onConflictDoUpdate({ target: [appUserDaily.day, appUserDaily.plan], set: { users: s.users, active: s.active, paying: s.paying, patients: s.patients, estimatedMrrMxn: s.estimatedMrrMxn } });
  }
  const removed = (await db.select({ uid: appUsers.uid }).from(appUsers).where(eq(appUsers.removedAt, now))).length;
  return { users: rows.length, removed, plans: summary.length };
}
