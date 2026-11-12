import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/leads", () => ({
  addNoteAction: vi.fn(), markRepliedAction: vi.fn(), moveLead: vi.fn(), postponeAction: vi.fn(), recordTouchAction: vi.fn(),
  setLeadStatusAction: vi.fn(), setNextActionAction: vi.fn(), referralLinkSentAction: vi.fn(), markTryingAction: vi.fn(), setChannelInvalidAction: vi.fn(),
}));
vi.mock("@/actions/sequences", () => ({ enrollAction: vi.fn(), stopEnrollmentAction: vi.fn() }));
vi.mock("@/actions/social-leads", () => ({ recordDmAction: vi.fn(), addContactChannelAction: vi.fn(), setSocialLeadTypeAction: vi.fn() }));

const { SocialPanel, SocialTodayRow, DmCounter } = await import("./social-leads");

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const lead = {
  id: "33333333-3333-4333-8333-333333333333", name: "Ana", priority: 2, leadStatus: "nuevo", jobTitle: null,
  socialPlatform: "instagram", socialHandle: "psic.ana", socialFollowers: "12k", socialTier: "micro", socialLeadType: "influencer",
  nextAction: null, nextActionOn: null,
} as unknown as Parameters<typeof SocialPanel>[0]["c"];
const url = "https://ziora-copilot.com/c/k7m2qxa";

describe("SocialPanel", () => {
  it("el panel muestra el mensaje del paso, el perfil y «Le escribí»", () => {
    const html = render(<SocialPanel c={lead} dm={{ key: "RI1", step: 1, text: "Hola, Ana…" }} inviteUrl={url} promoUrl={null} canManage />);
    expect(html).toContain("Primer mensaje");
    expect(html).toContain("Hola, Ana…");
    expect(html).toContain("Le escribí");
    expect(html).toContain("Copiar mensaje y abrir perfil");
    expect(html).toContain("https://www.instagram.com/psic.ana/");
    expect(html).toContain(url);
    expect(html).toContain("@psic.ana");
  });
  it("sin mensaje aprobado no ofrece texto", () => {
    const html = render(<SocialPanel c={lead} dm={{ key: "RI1", step: 1, text: null }} inviteUrl={url} promoUrl={null} canManage />);
    expect(html).toContain("Este mensaje aún no está aprobado por dirección");
    expect(html).not.toContain("Copiar mensaje y abrir perfil");
  });
  it("tras tres mensajes ya no ofrece «Le escribí»", () => {
    const html = render(<SocialPanel c={lead} dm={null} inviteUrl={url} promoUrl={null} canManage />);
    expect(html).toContain("Ya se mandaron los tres mensajes. Si no responde, márcalo perdido.");
    expect(html).not.toContain("Le escribí");
  });
  it("sin permiso de gestión no hay botones de acción", () => {
    const html = render(<SocialPanel c={lead} dm={{ key: "RI1", step: 1, text: "Hola, Ana…" }} inviteUrl={url} promoUrl={null} canManage={false} />);
    expect(html).toContain("Hola, Ana…");
    expect(html).not.toContain("Le escribí");
    expect(html).not.toContain("Respondió");
    expect(html).not.toContain("Agregar correo o teléfono");
  });
  it("etiqueta los seguimientos", () => {
    expect(render(<SocialPanel c={lead} dm={{ key: "RI2", step: 2, text: "x" }} inviteUrl={url} promoUrl={null} canManage />)).toContain("Seguimiento 1");
    expect(render(<SocialPanel c={lead} dm={{ key: "RI3", step: 3, text: "x" }} inviteUrl={url} promoUrl={null} canManage />)).toContain("Último seguimiento");
  });
});

describe("SocialTodayRow", () => {
  const dm1 = { key: "RI1", step: 1 as const, text: "Hola, Ana…" };
  it("sin permiso de gestión no hay botones de acción", () => {
    const html = render(<SocialTodayRow c={lead} owner="Ale" dm={dm1} canManage={false} />);
    for (const t of ["Le escribí", "Respondió", "Perdido", "Posponer", "Copiar mensaje y abrir perfil"]) expect(html).not.toContain(t);
  });
  it("sin liga no ofrece copiar ni registrar, pero deja marcar Respondió", () => {
    const html = render(<SocialTodayRow c={lead} owner="Ale" dm={dm1} canManage noLink />);
    expect(html).toContain("Abre la ficha para generar su liga");
    expect(html).not.toContain("Hola, Ana…");
    expect(html).not.toContain("Copiar mensaje y abrir perfil");
    expect(html).not.toContain("Le escribí");
    expect(html).toContain("Respondió");
  });
  it("tras tres mensajes sigue pudiendo marcar Respondió", () => {
    expect(render(<SocialTodayRow c={lead} owner="Ale" dm={null} canManage />)).toContain("Respondió");
    expect(render(<SocialPanel c={lead} dm={null} inviteUrl={url} promoUrl={null} canManage />)).toContain("Respondió");
  });
  it("muestra perfil, mensaje y acciones", () => {
    const html = render(<SocialTodayRow c={lead} owner="Ale" dm={dm1} canManage />);
    expect(html).toContain("https://www.instagram.com/psic.ana/");
    expect(html).toContain("Hola, Ana…");
    expect(html).toContain("Le escribí");
    expect(html).toContain("Respondió");
    expect(html).toContain("Perdido");
  });
});

describe("DmCounter", () => {
  it("el contador avisa solo al pasar de 30", () => {
    expect(render(<DmCounter sent={30} />)).not.toContain("bloquean");
    expect(render(<DmCounter sent={31} />)).toContain("bloquean");
    expect(render(<DmCounter sent={5} />)).toContain("Hoy llevas 5 DMs");
  });
});
