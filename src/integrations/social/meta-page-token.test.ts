import { afterEach, describe, expect, it, vi } from "vitest";
import { pageAccessToken } from "./meta";

afterEach(() => vi.unstubAllGlobals());

describe("pageAccessToken", () => {
  it("usa el token de página que devuelve Meta", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "PAGE_TOKEN", id: "123" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await pageAccessToken("123", "SYSTEM")).toEqual({ token: "PAGE_TOKEN" });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toMatch(/\/123$/);
    expect(url.searchParams.get("fields")).toBe("access_token");
    expect(url.searchParams.get("access_token")).toBe("SYSTEM");
  });

  it("si Meta falla, sigue con el token original y deja aviso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Unsupported get request" } }), { status: 400 })));
    const r = await pageAccessToken("123", "SYSTEM");
    expect(r.token).toBe("SYSTEM");
    expect(r.warning).toContain("Unsupported get request");
  });
});
