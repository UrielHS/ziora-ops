import { describe, expect, it, vi } from "vitest";
import { cleanGenerated, dmUserPrompt, generateDm, type DmAiLead } from "./social-dm-ai";

const liga = "https://ziora-copilot.com/c/AbC1234";
const base = `Hola Ana, soy Ale de Ziora 👋\n\nTe regalo 1 mes de Pro sin tarjeta:\n${liga}`;
const lead: DmAiLead = { name: "Ana Pérez", handle: "psic.ana", platform: "Instagram", leadType: "psicologo", approach: "TCC y ansiedad", city: "CDMX" };

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body }) as Response) as unknown as typeof fetch;
}
const reply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe("cleanGenerated", () => {
  it("quita markdown, comillas y líneas en blanco de más", () => {
    expect(cleanGenerated(`"**Hola** Ana\n\n\n\n${liga}"`, liga)).toBe(`Hola Ana\n\n${liga}`);
    expect(cleanGenerated("```\nHola " + liga + "\n```", liga)).toBe(`Hola ${liga}`);
  });
  it("rechaza si falta la liga exacta, si está vacío o si es demasiado largo", () => {
    expect(cleanGenerated("Hola Ana, aquí va: https://ziora-copilot.com/c/OTRA", liga)).toBeNull();
    expect(cleanGenerated("   ", liga)).toBeNull();
    expect(cleanGenerated(`${"a".repeat(1001)} ${liga}`, liga)).toBeNull();
  });
});

describe("dmUserPrompt", () => {
  it("incluye el mensaje aprobado, los datos y la bio recortada; omite lo vacío", () => {
    const p = dmUserPrompt({ lead: { ...lead, followers: null }, step: 2, base, bio: `  ${"x".repeat(2000)}  ` });
    expect(p).toContain("SEGUIMIENTO 1");
    expect(p).toContain(base);
    expect(p).toContain("Enfoque o temas: TCC y ansiedad");
    expect(p).not.toContain("Seguidores");
    expect(p).toContain("x".repeat(1500));
    expect(p).not.toContain("x".repeat(1501));
  });
});

describe("generateDm", () => {
  it("regresa el mensaje de la IA si trae la liga", async () => {
    const f = fakeFetch(reply(`Hola Ana 🌿 vi que trabajas ansiedad con TCC.\n\n${liga}`));
    const r = await generateDm({ lead, step: 1, base, liga }, { apiKey: "k", fetchImpl: f });
    expect(r).toEqual({ text: `Hola Ana 🌿 vi que trabajas ansiedad con TCC.\n\n${liga}`, ai: true });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toContain("gemini-3.1-flash-lite:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
  });
  it("ignora las partes de razonamiento del modelo", async () => {
    const f = fakeFetch({ candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text: `Hola ${liga}` }] } }] });
    expect((await generateDm({ lead, step: 1, base, liga }, { apiKey: "k", fetchImpl: f })).text).toBe(`Hola ${liga}`);
  });
  it("usa el mensaje aprobado si la IA cambia la liga, falla, tarda o no hay llave", async () => {
    const cases = [
      generateDm({ lead, step: 1, base, liga }, { apiKey: "k", fetchImpl: fakeFetch(reply("Hola sin liga")) }),
      generateDm({ lead, step: 1, base, liga }, { apiKey: "k", fetchImpl: fakeFetch({}, false, 429) }),
      generateDm({ lead, step: 1, base, liga }, { apiKey: "k", fetchImpl: vi.fn(async () => { throw new DOMException("t", "TimeoutError"); }) as unknown as typeof fetch }),
      generateDm({ lead, step: 1, base, liga }, { apiKey: "", fetchImpl: fakeFetch(reply(`x ${liga}`)) }),
    ];
    for (const r of await Promise.all(cases)) {
      expect(r.ai).toBe(false);
      expect(r.text).toBe(base);
      expect(r.note).toBeTruthy();
    }
  });
});
