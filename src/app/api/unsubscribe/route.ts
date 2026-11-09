import { db } from "@/db";
import { optOut } from "@/domain/contacts";
import { readUnsubscribeToken } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ziora</title>
<body style="font-family:system-ui,sans-serif;background:#eaf8f0;color:#1a2520;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="background:#fff;border-radius:24px;padding:40px;max-width:420px;text-align:center"><h1 style="font-size:22px">${title}</h1>
${body}
<p style="color:#4b5563">Si fue un error, escríbenos a hola@ziora-copilot.com.</p></div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function tokenFrom(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  return readUnsubscribeToken(requireEnv("UNSUBSCRIBE_SECRET"), t);
}

// Los escáneres de seguridad del correo abren los enlaces: un GET solo pregunta, nunca da de baja.
export async function GET(req: Request) {
  if (!tokenFrom(req)) return page("Enlace no válido", "", 400);
  return page(
    "¿Quieres dejar de recibir estos correos?",
    `<form method="post"><button type="submit" style="background:#1f6f4a;color:#fff;border:0;border-radius:999px;padding:10px 20px;font-size:15px;cursor:pointer">Sí, darme de baja</button></form>`,
  );
}

// La baja real. También atiende el one-click (RFC 8058) de Gmail/Outlook, que es POST.
export async function POST(req: Request) {
  const contactId = tokenFrom(req);
  if (!contactId) return page("Enlace no válido", "", 400);
  await optOut(db, contactId);
  return page("Listo, ya no recibirás estos correos.", "");
}
