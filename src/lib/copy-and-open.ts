/** «Copiar y abrir grupo»: prepara el post, copia el texto con la liga corta y abre el grupo en pestaña nueva. Las dependencias se inyectan para probarlo sin navegador. */
export type Prepared = { ok: true; postId: string; text: string; url: string } | { ok: false; error: string };

export async function copyAndOpen(
  prepare: () => Promise<Prepared>,
  env: { writeText: (text: string) => Promise<void>; open: (url: string, target: string, features: string) => unknown },
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  const r = await prepare();
  if (!r.ok) return r;
  try {
    await env.writeText(r.text);
  } catch {
    return { ok: false, error: "No se pudo copiar al portapapeles. Usa «Copiar texto» y abre el grupo a mano." };
  }
  env.open(r.url, "_blank", "noopener");
  return { ok: true, postId: r.postId };
}
