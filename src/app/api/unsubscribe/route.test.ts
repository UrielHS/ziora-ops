import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/domain/contacts", () => ({ optOut: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ readUnsubscribeToken: () => "c-1" }));

const { optOut } = await import("@/domain/contacts");
const { GET, POST } = await import("./route");

describe("baja de correo", () => {
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = "x";
    vi.mocked(optOut).mockClear();
  });

  it("GET muestra confirmación y no da de baja (los escáneres de correo siguen enlaces)", async () => {
    const res = await GET(new Request("https://ops.test/api/unsubscribe?t=abc"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('method="post"');
    expect(optOut).not.toHaveBeenCalled();
  });

  it("POST da de baja (también el one-click de Gmail/Outlook)", async () => {
    const res = await POST(new Request("https://ops.test/api/unsubscribe?t=abc", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(optOut).toHaveBeenCalledWith(expect.anything(), "c-1");
  });
});
