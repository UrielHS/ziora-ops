import { importAdsCsv, importOrganicCsv, saveSocialAccount, setCampaignUtm } from "@/actions/social";
import { btn, Field, inputCls, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import type { adCampaigns, socialAccounts } from "@/db/schema";
import { SOCIAL_PLATFORM } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";

type Account = typeof socialAccounts.$inferSelect;

export function lastDays(n: number, today: string) {
  const end = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function AccountButton({ a, trigger = "+ Cuenta", triggerClass }: { a?: Account; trigger?: string; triggerClass?: string }) {
  return (
    <Modal trigger={trigger} title={a ? `${SOCIAL_PLATFORM[a.platform]} · ${a.handle}` : "Conectar cuenta"} triggerClass={triggerClass ?? btn("ghost")}>
      <ActionForm action={saveSocialAccount}>
        {a && <input type="hidden" name="id" value={a.id} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Red"><Select name="platform" defaultValue={a?.platform ?? "instagram"} options={Object.entries(SOCIAL_PLATFORM)} /></Field>
          <Field label="Usuario"><input name="handle" required defaultValue={a?.handle} className={inputCls} placeholder="@ziora.mx" /></Field>
          <Field label="ID de la cuenta" hint="IG user id o page id. Vacío si solo importas CSV."><input name="externalId" defaultValue={a?.externalId ?? ""} className={inputCls} /></Field>
          <Field label="Cuenta publicitaria" hint="act_123… (opcional)"><input name="adAccountId" defaultValue={a?.adAccountId ?? ""} className={inputCls} /></Field>
        </div>
        <Field label={a?.tokenEncrypted ? "Token (guardado; deja vacío para conservarlo)" : "Token de acceso"} hint="Se guarda cifrado y nunca se vuelve a mostrar. Solo Meta tiene sincronización automática por ahora.">
          <input name="token" type="password" autoComplete="off" className={inputCls} />
        </Field>
        {a?.tokenEncrypted && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clearToken" className="h-4 w-4" /> Quitar el token guardado</label>}
        <Submit>Guardar</Submit>
      </ActionForm>
      {a && (
        <div className="mt-3 border-t border-line pt-3">
          <DeleteButton kind="social_account" id={a.id} what={`la cuenta ${a.handle ?? ""}`} warning="También se borran sus métricas diarias y publicaciones guardadas. Las campañas de anuncios se quedan." label="Eliminar cuenta" />
        </div>
      )}
    </Modal>
  );
}

export function ImportButton({ accounts, kind }: { accounts: Account[]; kind: "organic" | "ads" }) {
  return (
    <Modal trigger={kind === "organic" ? "Importar CSV" : "Importar CSV de anuncios"} title={kind === "organic" ? "Importar métricas de una red" : "Importar campañas"} triggerClass={btn("ghost")}>
      <ActionForm action={kind === "organic" ? importOrganicCsv : importAdsCsv}>
        <Field label="Cuenta"><Select name="accountId" options={accounts.map((a) => [a.id, `${SOCIAL_PLATFORM[a.platform]} · ${a.handle}`])} /></Field>
        <Field label="Archivo CSV"><input type="file" name="file" accept=".csv,text/csv" required className="text-sm" /></Field>
        <div className="rounded-xl bg-[#F7F6F0] p-3 text-xs text-muted">
          {kind === "organic" ? (
            <>Columnas reconocidas (español o inglés): <b>fecha</b> y cualquiera de seguidores, alcance, impresiones/visualizaciones, interacciones, visitas al perfil, clics en el enlace. Sirve la exportación de TikTok Studio, LinkedIn Page Analytics o de un agregador.</>
          ) : (
            <>Columnas mínimas: <b>fecha, campaña y gasto</b>. Opcionales: id de campaña, impresiones, clics, leads/resultados, conversiones. Sirve la exportación diaria de TikTok Ads o LinkedIn Campaign Manager.</>
          )}
          {" "}Volver a importar el mismo periodo actualiza los datos, no los duplica.
        </div>
        <Submit>Importar</Submit>
      </ActionForm>
    </Modal>
  );
}

export function UtmButton({ c }: { c: typeof adCampaigns.$inferSelect }) {
  return (
    <Modal trigger={c.utmCampaign ? c.utmCampaign : "Definir UTM"} title={`UTM de ${c.name}`} triggerClass="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-ink">
      <ActionForm action={setCampaignUtm}>
        <input type="hidden" name="id" value={c.id} />
        <Field label="utm_campaign" hint="El valor que llevan los enlaces de esta campaña hacia ziora-copilot.com/demo. Si lo dejas vacío se usa el nombre de la campaña.">
          <input name="utmCampaign" defaultValue={c.utmCampaign ?? ""} className={inputCls} placeholder="demo-psicologos-gdl" />
        </Field>
        <Submit>Guardar</Submit>
      </ActionForm>
    </Modal>
  );
}
