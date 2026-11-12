/**
 * «Copiar y abrir grupo». En iOS/Safari el portapapeles y la pestaña nueva solo se permiten durante el gesto del clic,
 * así que todo lo que necesita el gesto se hace de forma síncrona, ANTES de esperar al servidor:
 *  - la pestaña se abre en blanco y se redirige al grupo después (opener = null, igual de seguro que "noopener");
 *  - el portapapeles recibe una promesa del texto (ClipboardItem); si el navegador no lo soporta, se copia después de esperar.
 * Las dependencias se inyectan para probarlo sin navegador.
 */
export type Prepared = { ok: true; postId: string; text: string; url: string } | { ok: false; error: string };

export type TabLike = { opener: unknown; location: { href: string }; close: () => void; closed?: boolean };

export type CopyEnv = {
  /** Abre la pestaña en blanco (síncrono, dentro del gesto). Null si el navegador la bloqueó. */
  openBlank: () => TabLike | null;
  /** Solo si el navegador soporta ClipboardItem con promesa: debe llamarse dentro del gesto. */
  writeFromPromise?: (text: Promise<string>) => Promise<void>;
  /** Alternativa: se usa después de esperar al servidor. */
  writeText: (text: string) => Promise<void>;
};

const COPY_FAILED = "No se pudo copiar al portapapeles. Copia el texto de abajo y abre el grupo con «Abrir grupo».";
const TAB_BLOCKED = "El texto ya está copiado, pero el navegador bloqueó la pestaña. Usa «Abrir grupo».";

export async function copyAndOpen(
  prepare: () => Promise<Prepared>,
  env: CopyEnv,
): Promise<{ ok: true; postId: string; text: string } | { ok: false; error: string }> {
  const tab = env.openBlank();
  const prepared = prepare();
  // Se enlaza al gesto ahora mismo; un fallo del servidor rechaza esta promesa y se atiende abajo (sin rechazo sin manejar).
  const clip = env.writeFromPromise
    ? env.writeFromPromise(prepared.then((r) => { if (!r.ok) throw new Error(r.error); return r.text; })).then(() => null, (e: unknown) => e)
    : null;

  let r: Prepared;
  try { r = await prepared; } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : "No se pudo preparar el post" }; }
  if (!r.ok) {
    tab?.close();
    await clip;
    return r;
  }
  if (clip) {
    if ((await clip) !== null) { tab?.close(); return { ok: false, error: COPY_FAILED }; }
  } else {
    try { await env.writeText(r.text); } catch { tab?.close(); return { ok: false, error: COPY_FAILED }; }
  }
  if (!tab) return { ok: false, error: TAB_BLOCKED };
  tab.opener = null;
  tab.location.href = r.url;
  return { ok: true, postId: r.postId, text: r.text };
}
