import { describe, expect, it } from "vitest";
import { normalizeHandle, parseSocialCsv, socialProfileUrl } from "./social-leads";

describe("social-leads", () => {
  it("normalizeHandle: todas las formas del mismo usuario dan lo mismo", () => {
    for (const raw of ["@Psic.Ana_01", "psic.ana_01", " PSIC.ANA_01/ ", "https://www.instagram.com/psic.ana_01/",
      "instagram.com/Psic.Ana_01?igsh=abc123", "https://instagram.com/psic.ana_01/reels/", "https://www.tiktok.com/@psic.ana_01?lang=es"]) {
      expect(normalizeHandle(raw)).toBe("psic.ana_01");
    }
  });
  it("normalizeHandle rechaza lo que no es un usuario", () => {
    for (const raw of [null, undefined, "", "   ", "@", "con espacio", "a".repeat(31), "https://www.instagram.com/", "https://facebook.com/alguien", "ñandú"]) {
      expect(normalizeHandle(raw)).toBeNull();
    }
  });
  it("normalizeHandle: usuarios con punto que parecen dominio no se pierden", () => {
    for (const h of ["dra.lopez", "psic.ana", "terapia.mx"]) {
      for (const raw of [h, `@${h}`, `${h}/`, h.toUpperCase(), `https://www.instagram.com/${h}/`, `instagram.com/${h}?igsh=x`, `https://www.tiktok.com/@${h}?lang=es`]) {
        expect(normalizeHandle(raw)).toBe(h);
      }
    }
  });
  it("normalizeHandle: otras redes se rechazan; facebook.com a secas es un usuario sintácticamente válido", () => {
    expect(normalizeHandle("https://facebook.com/alguien")).toBeNull();
    expect(normalizeHandle("facebook.com/alguien")).toBeNull();
    expect(normalizeHandle("https://facebook.com")).toBeNull();
    expect(normalizeHandle("https://www.instagram.com")).toBeNull();
    expect(normalizeHandle("instagram.com")).toBeNull();
    expect(normalizeHandle("facebook.com")).toBe("facebook.com");
  });
  it("socialProfileUrl", () => {
    expect(socialProfileUrl("instagram", "psic.ana_01")).toBe("https://www.instagram.com/psic.ana_01/");
    expect(socialProfileUrl("tiktok", "psic.ana_01")).toBe("https://www.tiktok.com/@psic.ana_01");
  });
});

const INF = "﻿Nivel,Tipo,Plataforma,Usuario,Nombre,Enfoque,Ciudad,Seguidores,Dato de seguidores,Notas,Perfil\n" +
  "Micro,Creador,Instagram,@Psic.Ana,Ana Ruiz,TCC,CDMX,98.8K,verificado en perfil,\"nota, con coma\",https://www.instagram.com/psic.ana/\n" +
  "Por confirmar país,Clínica,TikTok,@centro.x,Centro X,,México,12K,snippet de búsqueda,,https://www.tiktok.com/@centro.x\n" +
  "Nano,Creador,Instagram,,Sin Usuario,,,,,,\n";
const PSI = "Zona,Alcaldía / municipio,Tipo,Usuario,Nombre,Enfoque,Señal de consulta,Seguidores,Perfil,Fuente,Notas,Estado DM,Responsable,Fecha DM,Respuesta\n" +
  "CDMX centro,Coyoacán,Consultorio/Centro,@Dra.Lopez,,duelo,presencial,1.2K,https://www.instagram.com/dra.lopez/,https://x.test/f,,Pendiente,,,\n" +
  "CDMX sur,Tlalpan,Psicólogo/a,@otra.psi,Otra Psi,,,,,,,Pendiente,,,\n";

describe("parseSocialCsv", () => {
  it("influencers: BOM, comas entre comillas, nivel y plataforma", () => {
    const { rows, skipped } = parseSocialCsv(INF, "influencers");
    expect(rows[0]).toMatchObject({ handle: "psic.ana", platform: "instagram", tier: "micro", leadType: "influencer", followers: "98.8K", notes: "nota, con coma", tags: ["influencer", "lead"], details: { tipo_csv: "Creador", dato_seguidores: "verificado en perfil" } });
    expect(rows[1]).toMatchObject({ handle: "centro.x", platform: "tiktok", tier: "por_confirmar_pais", tags: ["influencer", "lead", "clinic"] });
    expect(skipped).toEqual([{ line: 4, reason: "sin usuario" }]);
  });
  it("psicólogos: Instagram, sin nivel, nombre vacío cae al @", () => {
    const { rows, skipped } = parseSocialCsv(PSI, "psicologos");
    expect(skipped).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "@dra.lopez", handle: "dra.lopez", platform: "instagram", tier: null, leadType: "psicologo", cityName: "Coyoacán", tags: ["psychologist", "lead", "clinic"], details: { zona: "CDMX centro", tipo_csv: "Consultorio/Centro", senal_consulta: "presencial", fuente: "https://x.test/f" } });
    expect(rows[1]).toMatchObject({ name: "Otra Psi", tags: ["psychologist", "lead"], profileUrl: "https://www.instagram.com/otra.psi/" });
  });
  it("usuario que no es válido se salta", () => {
    const { rows, skipped } = parseSocialCsv("Usuario,Plataforma\ncon espacio,Instagram\n", "influencers");
    expect(rows).toEqual([]);
    expect(skipped).toEqual([{ line: 2, reason: "usuario inválido" }]);
  });
});
