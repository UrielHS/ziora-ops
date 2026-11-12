import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/leads", () => ({
  addNoteAction: vi.fn(), markRepliedAction: vi.fn(), moveLead: vi.fn(), postponeAction: vi.fn(), recordTouchAction: vi.fn(),
  setLeadStatusAction: vi.fn(), setNextActionAction: vi.fn(), referralLinkSentAction: vi.fn(), markTryingAction: vi.fn(), setChannelInvalidAction: vi.fn(),
}));
vi.mock("@/actions/sequences", () => ({ enrollAction: vi.fn(), stopEnrollmentAction: vi.fn() }));
vi.mock("@/actions/social-leads", () => ({ recordDmAction: vi.fn(), addContactChannelAction: vi.fn(), setSocialLeadTypeAction: vi.fn(), recordOpinionAction: vi.fn(), setInfluencerStageAction: vi.fn(), closeDealAction: vi.fn() }));

const { SocialPanel, SocialTodayRow, DmCounter, InfluencerPanel } = await import("./social-leads");

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
    expect(html).not.toContain("Le escribí");
  });
  it("si ya respondió no hay mensaje de DM, ni «Le escribí» ni «Respondió»", () => {
    const replied = { ...lead, leadStatus: "respondio" } as typeof lead;
    for (const el of [<SocialPanel key="p" c={replied} dm={null} inviteUrl={url} promoUrl={null} canManage />, <SocialTodayRow key="r" c={replied} owner="Ale" dm={null} canManage />]) {
      const html = render(el);
      expect(html).toContain("ya respondió o salió del seguimiento");
      expect(html).not.toContain("Le escribí");
      expect(html).not.toContain("Ya se mandaron los tres mensajes");
      expect(html).not.toMatch(/<button[^>]*>Respondió</);
    }
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

describe("InfluencerPanel", () => {
  const promo = "https://ziora-copilot.com/c/p7m2qxa";
  const using = { plan: "pro", lastActiveAt: new Date("2026-11-10T12:00:00Z"), sessionsTotal: 3, notesTotal: 2, removedAt: null };
  const inf = (o: object) => ({ ...lead, influencerStage: null, influencerOpinion: null, ...o }) as unknown as Parameters<typeof InfluencerPanel>[0]["c"];
  const base = { deal: null, appUser: null, promoUrl: null, canManage: true };

  it("sin cuenta ligada avisa que aún no se registra y pide la casilla para cerrar", () => {
    const html = render(<InfluencerPanel {...base} c={inf({ influencerStage: "quiere_promover" })} />);
    expect(html).toContain("Aún no se registra con su invitación");
    expect(html).toContain("Cerrar aunque todavía no usa Ziora");
    expect(html).toContain("Cerrar acuerdo");
  });
  it("con cuenta y sesiones muestra el uso y no ofrece la casilla", () => {
    const html = render(<InfluencerPanel {...base} appUser={using} c={inf({ influencerStage: "quiere_promover" })} />);
    expect(html).toContain("pro");
    expect(html).toContain("3 sesiones");
    expect(html).toContain("2 notas");
    expect(html).not.toContain("Cerrar aunque todavía no usa Ziora");
  });
  it("los botones de etapa siguen las transiciones", () => {
    const html = render(<InfluencerPanel {...base} c={inf({ influencerStage: "opinion_recibida" })} />);
    expect(html).toContain("Quiere promover");
    expect(html).toContain("No promueve");
    expect(html).not.toContain("Cerrar acuerdo");
  });
  it("con acuerdo muestra el acuerdo y la liga de promoción con sus clics, sin formularios", () => {
    const deal = { kind: "comision", terms: "20 %", notes: null, noUseOverride: true, closedOn: "2026-11-20" } as unknown as Parameters<typeof InfluencerPanel>[0]["deal"];
    const html = render(<InfluencerPanel {...base} deal={deal} promoUrl={promo} promoClicks={4} c={inf({ influencerStage: "acuerdo_cerrado" })} />);
    expect(html).toContain("Acuerdo cerrado");
    expect(html).toContain("20 %");
    expect(html).toContain(promo);
    expect(html).toContain("4 clics");
    expect(html).toContain("sin uso de Ziora");
    expect(html).not.toContain("Cerrar acuerdo");
    expect(html).not.toContain("No promueve");
  });
  it("sin permiso de gestión no hay formularios", () => {
    const html = render(<InfluencerPanel {...base} canManage={false} c={inf({ influencerStage: "quiere_promover", influencerOpinion: "Le gustó" })} />);
    expect(html).toContain("Le gustó");
    for (const t of ["Cerrar acuerdo", "Guardar opinión", "No promueve"]) expect(html).not.toContain(t);
  });
});
