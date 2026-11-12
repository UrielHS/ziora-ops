import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/domain/community-posts", async (orig) => ({
  ...(await orig<typeof import("@/domain/community-posts")>()),
  resolvePostLink: vi.fn(async (_db: unknown, code: string) =>
    code === "k7m2qx" ? { utm: { utm_source: "facebook", utm_medium: "comunidad", utm_campaign: "c", utm_content: "fb-x", utm_term: "k7m2qx" } } : null),
}));

const { resolvePostLink } = await import("@/domain/community-posts");
const { POST } = await import("./route");

const call = (body: unknown, headers: Record<string, string> = { authorization: "Bearer s3cret" }) =>
  POST(new Request("http://x/api/community-links/resolve", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/community-links/resolve", () => {
  beforeEach(() => {
    process.env.COMMUNITY_LINK_SECRET = "s3cret";
    vi.mocked(resolvePostLink).mockClear();
  });

  it("401 sin Bearer o con secreto equivocado", async () => {
    expect((await call({ code: "k7m2qx" }, {})).status).toBe(401);
    expect((await call({ code: "k7m2qx" }, { authorization: "Bearer otro" })).status).toBe(401);
    expect(resolvePostLink).not.toHaveBeenCalled();
  });

  it("el JOB_SECRET no sirve en esta ruta", async () => {
    process.env.JOB_SECRET = "job";
    expect((await call({ code: "k7m2qx" }, { authorization: "Bearer job" })).status).toBe(401);
  });

  it("400 con código de formato inválido o cuerpo roto", async () => {
    expect((await call({ code: "ZZZ" })).status).toBe(400);
    expect((await call({ code: "k7m2q0" })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call("no es json")).status).toBe(400);
    expect(resolvePostLink).not.toHaveBeenCalled();
  });

  it("código válido devuelve las 5 llaves UTM; count solo si viene true", async () => {
    const res = await call({ code: "k7m2qx", count: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Object.keys(json.utm).sort()).toEqual(["utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"]);
    expect(resolvePostLink).toHaveBeenLastCalledWith(expect.anything(), "k7m2qx", { count: true });
    await call({ code: "k7m2qx" });
    expect(resolvePostLink).toHaveBeenLastCalledWith(expect.anything(), "k7m2qx", { count: false });
  });

  it("404 si el código no existe", async () => {
    const res = await call({ code: "zzzzzz" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
  });
});
