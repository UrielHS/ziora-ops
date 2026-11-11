import { describe, expect, it } from "vitest";
import { estimatedMrr, followupCandidates, isActive, isPaying, looksLikeTestAccount, payState, realMrr, Snapshot, summarizeByPlan } from "./app-users";

const now = new Date("2026-11-03T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
const prices = [
  { plan: "free", priceMxn: 0, billingPeriod: "monthly" as const, paying: false },
  { plan: "pro", priceMxn: 590, billingPeriod: "monthly" as const, paying: true },
  { plan: "pro_anual", priceMxn: 5900, billingPeriod: "annual" as const, paying: true },
];

describe("snapshot de la app", () => {
  const user = { uid: "u1", email: "psic@example.com", plan: "pro", status: "active", patientCount: 12, sessionsLast30d: 30 };
  it("acepta solo los campos permitidos", () => {
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [user] }).success).toBe(true);
  });
  it("acepta los campos de suscripción opcionales", () => {
    const billing = { billingPeriod: "annual", mrrAmount: 491.67, currency: "mxn", currentPeriodEnd: "2027-01-01T00:00:00Z", cancelAtPeriodEnd: true };
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...user, ...billing }] }).success).toBe(true);
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...user, billingPeriod: null, mrrAmount: null, currency: null, currentPeriodEnd: null }] }).success).toBe(true);
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...user, currency: "MXN" }] }).success).toBe(false);
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...user, mrrAmount: -1 }] }).success).toBe(false);
  });
  it("acepta suscripciones semestrales (6 meses −10 %, nov-2026) y rechaza periodos desconocidos", () => {
    const at = (billingPeriod: string) => Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...user, billingPeriod, mrrAmount: 629.17, currency: "mxn" }] }).success;
    expect(at("semiannual")).toBe(true);
    expect(at("quarterly")).toBe(false);
  });
  it("rechaza cualquier campo extra (protección de datos de pacientes)", () => {
    const r = Snapshot.safeParse({ generatedAt: now.toISOString(), users: [{ ...user, patients: [{ name: "X" }] }] });
    expect(r.success).toBe(false);
    expect(Snapshot.safeParse({ generatedAt: now.toISOString(), users: [], patientNames: [] }).success).toBe(false);
  });
});

describe("métricas", () => {
  it("activo = entró en los últimos 14 días", () => {
    expect(isActive(daysAgo(3), now)).toBe(true);
    expect(isActive(daysAgo(15), now)).toBe(false);
    expect(isActive(null, now)).toBe(false);
  });

  const users = [
    { plan: "pro", status: "active", lastActiveAt: daysAgo(1), patientCount: 10 },
    { plan: "pro", status: "trialing", lastActiveAt: daysAgo(2), patientCount: 3 },
    { plan: "pro", status: "cancelled", lastActiveAt: daysAgo(40), patientCount: 7 },
    { plan: "pro_anual", status: "active", lastActiveAt: daysAgo(20), patientCount: 20 },
    { plan: "free", status: "active", lastActiveAt: daysAgo(1), patientCount: 2 },
  ];
  it("MRR estimado: solo de pago, sin trials ni cancelados; anual entre 12", () => {
    expect(estimatedMrr(users, prices)).toBe(590 + 492);
  });
  it("resumen por plan", () => {
    expect(summarizeByPlan(users, prices, now).find((s) => s.plan === "pro")).toEqual({ plan: "pro", users: 3, active: 2, paying: 1, patients: 20, estimatedMrrMxn: 590 });
  });
  it("candidatos a seguimiento", () => {
    const c = followupCandidates([
      { plan: "pro_anual", status: "active", lastActiveAt: daysAgo(9), patientCount: 1, trialEndsAt: null },
      { plan: "pro", status: "active", lastActiveAt: daysAgo(2), patientCount: 1, trialEndsAt: null },
      { plan: "pro", status: "trialing", lastActiveAt: daysAgo(1), patientCount: 1, trialEndsAt: new Date(now.getTime() + 3 * 86400000) },
      { plan: "pro", status: "trialing", lastActiveAt: daysAgo(1), patientCount: 1, trialEndsAt: new Date(now.getTime() + 9 * 86400000) },
    ], prices, now);
    expect(c.map((x) => x.reason)).toEqual(["paying_inactive", "trial_ending"]);
  });
});

describe("MRR real de Stripe", () => {
  it("usa el monto real cuando viene en pesos y cae a plan × precio si no", () => {
    expect(realMrr({ mrrCents: 49167, currency: "mxn" })).toBe(491.67);
    expect(realMrr({ mrrCents: 2000, currency: "usd" })).toBeNull();
    expect(realMrr({ mrrCents: null })).toBeNull();
    const users = [
      { plan: "pro", status: "active", mrrCents: 50000, currency: "mxn" }, // cupón: paga 500, no 590
      { plan: "pro", status: "active" }, // sin dato real: 590
      { plan: "pro", status: "active", mrrCents: 0, currency: "mxn" }, // 100% de descuento: no paga
      { plan: "pro", status: "past_due", mrrCents: 59000, currency: "mxn" },
      { plan: "pro", status: "trialing", mrrCents: 59000, currency: "mxn" },
    ];
    expect(estimatedMrr(users, prices)).toBe(500 + 590 + 590);
    expect(isPaying(users[2], prices)).toBe(false);
    expect(isPaying({ plan: "pro", status: "unpaid", mrrCents: 59000, currency: "mxn" }, prices)).toBe(false);
    expect(isPaying({ plan: "pro", status: "incomplete", mrrCents: 59000, currency: "mxn" }, prices)).toBe(false);
    // Pro otorgado a mano: sin suscripción en Stripe (status "free", mrrAmount null) no es de pago
    expect(isPaying({ plan: "pro", status: "free", mrrCents: null, currency: null }, prices)).toBe(false);
    expect(isPaying({ plan: "free", status: "active", mrrCents: 10000, currency: "mxn" }, prices)).toBe(true);
  });
});

describe("estado de pago y cuentas de prueba", () => {
  it("payState distingue pago real, cortesía, prueba, cancelada y sin suscripción", () => {
    expect(payState({ plan: "pro", status: "active", mrrCents: 69900, currency: "mxn" }, prices)).toBe("paying");
    expect(payState({ plan: "pro", status: "active", mrrCents: 0, currency: "mxn" }, prices)).toBe("courtesy");
    expect(payState({ plan: "pro", status: "trialing", mrrCents: 0, currency: "mxn" }, prices)).toBe("trial");
    expect(payState({ plan: "free", status: "canceled", mrrCents: 0, currency: "mxn" }, prices)).toBe("cancelled");
    expect(payState({ plan: "pro", status: "unpaid", mrrCents: 69900, currency: "mxn" }, prices)).toBe("cancelled");
    expect(payState({ plan: "pro", status: "free", mrrCents: null, currency: null }, prices)).toBe("none");
    expect(payState({ plan: "free", status: "free", mrrCents: 0, currency: null }, prices)).toBe("none");
    // Versión vieja de la app sin dato real: plan de pago cuenta como pago
    expect(payState({ plan: "pro", status: "active" }, prices)).toBe("paying");
  });
  it("looksLikeTestAccount: dominio de Ziora, correos desechables y alias +test", () => {
    expect(looksLikeTestAccount("chris+test01@ziora-copilot.com")).toBe(true);
    expect(looksLikeTestAccount("Eurídice@Ziora-Copilot.com")).toBe(true);
    expect(looksLikeTestAccount("lagomap496@ebflyai.com")).toBe(true);
    expect(looksLikeTestAccount("chris+j2@gmail.com")).toBe(true);
    expect(looksLikeTestAccount("chris+dev12@gmail.com")).toBe(true);
    expect(looksLikeTestAccount("alguien+prueba@gmail.com")).toBe(true);
    expect(looksLikeTestAccount("psic.agape@gmail.com")).toBe(false);
    expect(looksLikeTestAccount("rafacv2000@gmail.com")).toBe(false);
    expect(looksLikeTestAccount("maria+consultorio@gmail.com")).toBe(false);
    expect(looksLikeTestAccount("0250002@up.edu.mx")).toBe(false);
    expect(looksLikeTestAccount("sin-arroba")).toBe(false);
  });
});
