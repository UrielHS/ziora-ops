import { describe, expect, it } from "vitest";
import { templateVariables } from "@/domain/template";
import { MTW_SEQUENCE } from "./seed-secuencia-mtw";

const words = (s: string) => s.trim().split(/\s+/).length;

describe("semilla MTW 4 toques", () => {
  it("tiene 4 pasos 0/3/7/14 alternando correo y WhatsApp", () => {
    expect(MTW_SEQUENCE.name).toBe("MTW 4 toques");
    expect(MTW_SEQUENCE.steps.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(MTW_SEQUENCE.steps.map((s) => s.dayOffset)).toEqual([0, 3, 7, 14]);
    expect(MTW_SEQUENCE.steps.map((s) => s.channel)).toEqual(["email", "whatsapp", "email", "whatsapp"]);
  });

  it("los correos traen liga de baja, usan {{nombre}} y {{remitente}}, y tienen menos de 120 palabras", () => {
    for (const s of MTW_SEQUENCE.steps.filter((s) => s.channel === "email")) {
      expect(s.template).toBeDefined();
      expect(s.template!.html).toContain('<a href="{{{baja}}}"');
      const vars = templateVariables(s.template!.html + " " + s.template!.subject);
      expect(vars).toContain("nombre");
      expect(vars).toContain("remitente");
      expect(words(s.template!.html.replace(/<[^>]+>/g, " "))).toBeLessThan(120);
    }
    expect(MTW_SEQUENCE.steps[0].template!.name).toBe("MTW · Toque 1 · Nos vimos en Mexico Tech Week");
    expect(MTW_SEQUENCE.steps[0].template!.html).toMatch(/Mexico Tech Week/);
    expect(MTW_SEQUENCE.steps[2].template!.name).toBe("MTW · Toque 3 · 15 minutos para enseñarte Ziora");
  });

  it("los WhatsApp son texto plano, usan {{nombre}} y tienen 60 palabras o menos; el toque 4 se despide", () => {
    const wa = MTW_SEQUENCE.steps.filter((s) => s.channel === "whatsapp");
    for (const s of wa) {
      expect(s.whatsappText).toBeDefined();
      expect(s.whatsappText).not.toMatch(/<[a-z]/i);
      expect(templateVariables(s.whatsappText!)).toContain("nombre");
      expect(words(s.whatsappText!)).toBeLessThanOrEqual(60);
    }
    expect(wa[1].whatsappText).toMatch(/no te vuelvo a escribir|aquí quedo/i);
  });
});
