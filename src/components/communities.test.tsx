import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/communities", () => ({
  createCommunityAction: vi.fn(), createPostAction: vi.fn(), markDeletedByAdminAction: vi.fn(), markPublishedAction: vi.fn(),
  prepareCopyAndOpenAction: vi.fn(), registerInterestedAction: vi.fn(), reviewCommunityAction: vi.fn(), setBaseMessageStatusAction: vi.fn(),
  setMembershipAction: vi.fn(), setPromoPolicyAction: vi.fn(), skipPostAction: vi.fn(), updatePostTextAction: vi.fn(),
}));

import type { QueueCandidate } from "@/domain/community-queue";

const { AttributionPanel, GeneratePost, MembershipButtons, PostCard, PromoPolicyForm, PublishQueue, ReviewForm } = await import("./communities");
const { copyAndOpen } = await import("@/lib/copy-and-open");
const { buildPublishQueue, leastUsedKey, postBlockReason, WEEKLY_POSTS_PER_PUBLISHER } = await import("@/domain/community-queue");

const LINK = "https://ziora-copilot.com/c/k7m2qx";
const base = {
  id: "11111111-1111-4111-8111-111111111111", code: "k7m2qx", status: "planeado", finalText: `Hola, soy Paulina. Pruébalo: ${LINK}`,
  postUrl: null, publishedAt: null, clicks: 0,
};

describe("PostCard", () => {
  it("la tarjeta de un post planeado trae texto con liga, copiar y marcar publicado", () => {
    const html = renderToStaticMarkup(<PostCard post={base} communityName="Psicólogos CDMX" />);
    expect(html).toContain(LINK);
    expect(html).toContain("Copiar texto");
    expect(html).toContain("Marcar publicado");
    expect(html).not.toContain("Registrar interesado");
  });
  it("un post publicado ofrece registrar interesado y ya no ofrece publicar", () => {
    const html = renderToStaticMarkup(<PostCard post={{ ...base, status: "publicado", publishedAt: new Date("2026-11-10T12:00:00Z"), postUrl: "https://fb.com/p/1" }} />);
    expect(html).toContain("Registrar interesado");
    expect(html).toContain("Abrir post");
    expect(html).not.toContain("Marcar publicado");
  });
});

describe("generar post", () => {
  const c = { kind: "grupo" as const, status: "aprobada", promoPolicy: "desconocido" as const };
  it("sin elegibilidad, generar post aparece deshabilitado con el motivo", () => {
    const reason = postBlockReason(c, "unida", null, new Date());
    expect(reason).toBe("Registra primero la política de promoción");
    const html = renderToStaticMarkup(<GeneratePost communityId={base.id} keys={["M1", "M2"]} reason={reason} />);
    expect(html).toContain("Registra primero la política de promoción");
    expect(html).toMatch(/<button[^>]*disabled/);
  });
  it("con política sí y membresía no hay motivo; sin membresía lo dice", () => {
    expect(postBlockReason({ ...c, promoPolicy: "si" }, "unida", null, new Date())).toBeNull();
    expect(postBlockReason({ ...c, promoPolicy: "si" }, null, null, new Date())).toBe("Aún no eres miembro del grupo");
  });
});

describe("AttributionPanel", () => {
  it("el panel de atribución muestra comunidad, código y quién registró", () => {
    const html = renderToStaticMarkup(
      <AttributionPanel communityId={base.id} communityName="Psicólogos CDMX" postCode="k7m2qx"
        utm={{ utm_source: "facebook", utm_medium: "comunidad", utm_campaign: "prueba-1-mes-202611", utm_term: "k7m2qx" }}
        registeredBy="Paulina Gómez" registeredAt={new Date("2026-11-11T12:00:00Z")} />,
    );
    expect(html).toContain("Psicólogos CDMX");
    expect(html).toContain("k7m2qx");
    expect(html).toContain("Paulina Gómez");
    expect(html).toContain("campaign: prueba-1-mes-202611");
  });
  it("sin atribución muestra guiones", () => {
    const html = renderToStaticMarkup(<AttributionPanel communityId={null} communityName={null} postCode={null} utm={{}} registeredBy={null} registeredAt={null} />);
    expect(html).toContain("—");
  });
});

describe("otros componentes", () => {
  it("revisión ofrece aprobar, alianza y descartar con motivo", () => {
    const html = renderToStaticMarkup(<ReviewForm id={base.id} />);
    expect(html).toContain("Aprobar");
    expect(html).toContain("Es una alianza");
    expect(html).toContain("Descartar");
    expect(html).toContain("Es para pacientes");
  });
  it("membresía ofrece abrir el grupo (pestaña nueva) y avisar que ya pidió entrar", () => {
    const html = renderToStaticMarkup(<MembershipButtons communityId={base.id} url="https://fb.com/groups/1" status={null} />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Ya pedí entrar");
    expect(html).toContain("Ya estoy dentro");
  });
  it("con permiso del admin muestra el M0 renderizado para copiar", () => {
    const html = renderToStaticMarkup(<PromoPolicyForm communityId={base.id} policy="permiso_admin" rulesText={null} adminMessage="Hola admin, soy Paulina" />);
    expect(html).toContain("Hola admin, soy Paulina");
    const sin = renderToStaticMarkup(<PromoPolicyForm communityId={base.id} policy="si" rulesText={null} adminMessage="Hola admin" />);
    expect(sin).not.toContain("Hola admin");
  });
});

describe("copiar y abrir", () => {
  const deferred = () => { let resolve!: (v: unknown) => void; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  const mkTab = () => ({ opener: "x" as unknown, location: { href: "about:blank" }, close: vi.fn() });
  const ready = { ok: true as const, postId: base.id, text: `Hola ${LINK}`, url: "https://www.facebook.com/groups/1734077966820764" };

  it("copiar y abrir crea el post, copia texto con liga corta y abre el grupo (con ClipboardItem)", async () => {
    const tab = mkTab();
    const d = deferred();
    const order: string[] = [];
    let copied: Promise<string> | null = null;
    const prepare = vi.fn(() => { order.push("prepare"); return d.promise as Promise<typeof ready>; });
    const openBlank = vi.fn(() => { order.push("open"); return tab; });
    const writeFromPromise = vi.fn((t: Promise<string>) => { order.push("write"); copied = t; return t.then(() => undefined); });
    const writeText = vi.fn();
    const run = copyAndOpen(prepare, { openBlank, writeFromPromise, writeText });
    // Antes de que responda el servidor (todavía dentro del gesto) la pestaña y el portapapeles ya están enlazados.
    expect(order).toEqual(["open", "prepare", "write"]);
    expect(tab.location.href).toBe("about:blank");
    d.resolve(ready);
    const r = await run;
    expect(r).toEqual({ ok: true, postId: base.id, text: ready.text });
    expect(await copied).toEqual(expect.stringContaining("https://ziora-copilot.com/c/"));
    expect(tab.location.href).toBe("https://www.facebook.com/groups/1734077966820764");
    expect(tab.opener).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });
  it("sin ClipboardItem copia con writeText después de esperar y abre la pestaña que ya estaba abierta", async () => {
    const tab = mkTab();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const openBlank = vi.fn(() => tab);
    const r = await copyAndOpen(async () => ready, { openBlank, writeText });
    expect(openBlank).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("https://ziora-copilot.com/c/"));
    expect(r.ok).toBe(true);
    expect(tab.location.href).toBe(ready.url);
  });
  it("si no se puede preparar el post cierra la pestaña y no copia ni navega", async () => {
    const tab = mkTab();
    const writeFromPromise = vi.fn((t: Promise<string>) => t.then(() => undefined));
    const r = await copyAndOpen(async () => ({ ok: false, error: "Aún no eres miembro del grupo" }), { openBlank: () => tab, writeFromPromise, writeText: vi.fn() });
    expect(r).toEqual({ ok: false, error: "Aún no eres miembro del grupo" });
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("about:blank");
  });
  it("si el portapapeles falla avisa, cierra la pestaña y no abre el grupo", async () => {
    const tab = mkTab();
    const r = await copyAndOpen(async () => ready, { openBlank: () => tab, writeText: () => Promise.reject(new Error("denied")) });
    expect(r.ok).toBe(false);
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("about:blank");
  });
  it("si el navegador bloqueó la pestaña avisa que el texto ya está copiado", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const r = await copyAndOpen(async () => ready, { openBlank: () => null, writeText });
    expect(writeText).toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Abrir grupo") });
  });
});

describe("cola de publicar", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const day = 86_400_000;
  const mk = (name: string, over: Record<string, unknown> = {}, lastDaysAgo: number | null = null, planned = null as null | { postId: string; code: string; text: string; key: string | null }): QueueCandidate => ({
    community: { id: name, name, url: `https://fb.com/${name}`, platform: "facebook", priority: "A", kind: "grupo", status: "aprobada", promoPolicy: "si", ...over } as QueueCandidate["community"],
    membership: "unida",
    lastPublishedAt: lastDaysAgo === null ? null : new Date(now.getTime() - lastDaysAgo * day),
    usage: {}, planned,
  });
  const keys = ["M1", "M2", "M3"];

  it("la cola de publicar respeta el cupo semanal y oculta grupos no elegibles", () => {
    const cands = [
      mk("c1", { priority: "C" }, 40), mk("a2", { priority: "A" }, 30), mk("a1", { priority: "A" }, 90), mk("b1", { priority: "B" }, null),
      mk("reciente", { priority: "A" }, 5), // publicado hace 5 días: no elegible
      mk("sin-politica", { promoPolicy: "desconocido" }), mk("alianza", { kind: "alianza" }), mk("por-revisar", { status: "por_revisar" }),
    ];
    const { rows, remaining } = buildPublishQueue(cands, keys, 0, now);
    expect(WEEKLY_POSTS_PER_PUBLISHER).toBe(3);
    expect(rows.map((r) => r.community.name)).toEqual(["a1", "a2", "b1"]); // A (más antiguo primero), luego B; el tope es 3
    expect(remaining).toBe(3);
  });
  it("lo ya publicado esta semana y lo ya copiado gastan cupo", () => {
    const cands = [mk("a1", {}, 90), mk("a2", {}, 80), mk("a3", {}, 70), mk("copiado", {}, 60, { postId: "p", code: "k7m2qx", text: "t", key: "M2" })];
    const r = buildPublishQueue(cands, keys, 1, now);
    expect(r.rows.map((x) => x.community.name)).toEqual(["copiado", "a1"]); // 3 − 1 publicado − 1 copiado = 1 nuevo
    expect(r.rows[0].defaultKey).toBe("M2");
    expect(buildPublishQueue(cands, keys, 3, now).rows.map((x) => x.community.name)).toEqual(["copiado"]);
  });
  it("un post ya copiado sale de la cola si dejó de ser elegible (otra publicó hace poco)", () => {
    const stale = mk("copiado", {}, 0, { postId: "p", code: "k7m2qx", text: "t", key: "M1" });
    expect(buildPublishQueue([stale], keys, 0, now).rows).toEqual([]);
  });
  it("el mensaje por defecto es el menos usado en ese grupo", () => {
    expect(leastUsedKey(["M1", "M2", "M3"], { M1: 2, M2: 0, M3: 1 })).toBe("M2");
    expect(leastUsedKey(["M1", "M2", "M3"], {})).toBe("M1");
  });
  it("la vista renderiza «Copiar y abrir grupo» por fila y el aviso de cupo lleno", () => {
    const { rows } = buildPublishQueue([mk("a1", {}, 90)], keys, 0, now);
    const html = renderToStaticMarkup(<PublishQueue rows={rows} messageKeys={keys} remaining={2} publishedThisWeek={0} quota={3} />);
    expect(html).toContain("Copiar y abrir grupo");
    expect(html).not.toContain("Marcar publicado");
    const planned = buildPublishQueue([mk("a1", {}, 90, { postId: "p", code: "k7m2qx", text: `Hola ${LINK}`, key: "M1" })], keys, 0, now).rows;
    const withPost = renderToStaticMarkup(<PublishQueue rows={planned} messageKeys={keys} remaining={2} publishedThisWeek={0} quota={3} />);
    expect(withPost).toContain("Copiar texto"); // camino manual siempre disponible
    expect(withPost).toContain(LINK);
    expect(withPost).toMatch(/<a href="https:\/\/fb\.com\/a1" target="_blank" rel="noopener noreferrer"[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)? ?Abrir grupo/);
    expect(withPost).toContain("Marcar publicado");
    const vacio = renderToStaticMarkup(<PublishQueue rows={[]} messageKeys={keys} remaining={0} publishedThisWeek={3} quota={3} />);
    expect(vacio).toContain("Ya completaste tus 3 posts de los últimos 7 días");
  });
});
