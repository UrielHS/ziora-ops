/**
 * Imita el endpoint POST /ops/snapshot de ziora-api (docs/API-ZIORA-APP.md) para probar sin la app.
 *
 *   ZIORA_APP_BRIDGE_SECRET=local npx tsx dev/fake-ziora-app.ts     # http://localhost:5055/ops/snapshot
 *
 * En Ziora Ops: ZIORA_APP_SNAPSHOT_URL=http://localhost:5055/ops/snapshot y el mismo secreto.
 * Datos ficticios (@example.com). La mitad de las cuentas trae datos de suscripción y la otra mitad no.
 */
import { createServer } from "node:http";
import { hmacSha256Hex, verifyHmac } from "../src/lib/crypto";

const secret = process.env.ZIORA_APP_BRIDGE_SECRET ?? "local";
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const plans = ["free", "pro", "pro", "pro_anual", "clinic"];
const statuses = ["active", "active", "active", "trialing", "canceled", "past_due", "unpaid"];
const users = Array.from({ length: 40 }, (_, i) => ({
  uid: `fake-${i}`,
  email: `terapeuta${i}@example.com`,
  name: `Psic. Ficticia ${i}`,
  plan: plans[i % plans.length],
  status: statuses[(i * 3) % statuses.length],
  createdAt: ago(120 - i * 2),
  lastActiveAt: ago((i * 7) % 30),
  trialEndsAt: statuses[(i * 3) % statuses.length] === "trialing" ? new Date(Date.now() + ((i % 6) + 1) * DAY).toISOString() : null,
  patientCount: (i * 7) % 45,
  sessionsLast30d: (i * 11) % 80,
  ...(i % 2 === 0 && {
    billingPeriod: plans[i % plans.length] === "pro_anual" ? "annual" : "monthly",
    mrrAmount: plans[i % plans.length] === "free" ? 0 : plans[i % plans.length] === "pro_anual" ? 491.67 : 590,
    currency: "mxn",
    currentPeriodEnd: new Date(Date.now() + ((i % 25) + 3) * DAY).toISOString(),
    cancelAtPeriodEnd: i % 10 === 0,
  }),
}));

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const fresh = (() => {
      try {
        const t = Date.parse(JSON.parse(body).requestedAt);
        return Date.now() - t <= 5 * 60_000 && t - Date.now() <= 60_000;
      } catch {
        return false;
      }
    })();
    if (!["/ops/snapshot", "/opsSnapshot"].includes(req.url ?? "") || !verifyHmac(secret, body, req.headers["x-ops-signature"] as string) || !fresh) {
      res.writeHead(401).end(JSON.stringify({ error: "no autorizado" }));
      return;
    }
    // Con "v": 2 el backend añade atribución y señales de uso; sin ella responde exactamente como v1.
    const v2 = (() => { try { return JSON.parse(body).v === 2; } catch { return false; } })();
    const out = JSON.stringify({
      generatedAt: new Date().toISOString(),
      users: v2
        ? users.map((u, i) => ({
            ...u,
            attribution: i % 5 === 0 ? { utm_source: "facebook", utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611" } : null,
            trialKind: i % 5 === 0 ? "community" : null,
            hasPaidInvoice: u.status === "active" && u.plan !== "free",
            feedbackCount: i % 7 === 0 ? 1 : 0, sessionsTotal: (i * 13) % 120, notesTotal: (i * 5) % 60,
          }))
        : users,
    });
    res.writeHead(200, { "content-type": "application/json", "x-ops-signature": hmacSha256Hex(secret, out) }).end(out);
  });
}).listen(5055, () => console.log("/ops/snapshot falso en http://localhost:5055/ops/snapshot"));
