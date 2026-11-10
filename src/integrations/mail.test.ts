import { describe, expect, it } from "vitest";
import { mailTransport } from "./mail";
import { sendBatchSmtp, toSmtpMessage } from "./smtp";

const email = { to: "ana@x.mx", subject: "Hola", html: "<p>hola</p>", unsubscribeUrl: "https://ops/api/unsubscribe?t=abc", replyTo: "rafa@ziora-copilot.com" };

describe("mailTransport (qué transporte usa Ops)", () => {
  it("SMTP (relay de Workspace) cuando hay SMTP_HOST; Resend solo si no hay SMTP; nada si falta todo", () => {
    expect(mailTransport({ SMTP_HOST: "smtp-relay.gmail.com" })).toBe("smtp");
    expect(mailTransport({ SMTP_HOST: "smtp-relay.gmail.com", RESEND_API_KEY: "re_x" })).toBe("smtp");
    expect(mailTransport({ RESEND_API_KEY: "re_x" })).toBe("resend");
    expect(mailTransport({})).toBeNull();
  });
});

describe("SMTP: cómo se arma y manda cada correo", () => {
  it("lleva from, replyTo al dueño y cabeceras de baja en un clic", () => {
    const m = toSmtpMessage("Ziora <soporte@ziora-copilot.com>", email);
    expect(m).toMatchObject({ from: "Ziora <soporte@ziora-copilot.com>", to: "ana@x.mx", subject: "Hola", html: "<p>hola</p>", replyTo: "rafa@ziora-copilot.com" });
    expect(m.headers).toMatchObject({ "List-Unsubscribe": "<https://ops/api/unsubscribe?t=abc>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });
  it("manda uno por uno en orden y devuelve el id de cada mensaje", async () => {
    const sent: string[] = [];
    const fake = { sendMail: async (o: { to?: unknown }) => { sent.push(String(o.to)); return { messageId: `<${sent.length}@relay>` }; } };
    const ids = await sendBatchSmtp("Ziora <soporte@ziora-copilot.com>", [email, { ...email, to: "bea@x.mx" }], fake);
    expect(sent).toEqual(["ana@x.mx", "bea@x.mx"]);
    expect(ids).toEqual(["<1@relay>", "<2@relay>"]);
  });
  it("si el relay rechaza, el error dice SMTP y qué pasó (la cadencia lo registra y reintenta)", async () => {
    const fake = { sendMail: async () => { throw new Error("535 Authentication failed"); } };
    await expect(sendBatchSmtp("Ziora <x@ziora-copilot.com>", [email], fake)).rejects.toThrow(/^SMTP: 535/);
  });
});
