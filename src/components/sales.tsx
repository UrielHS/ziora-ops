import { addAccountContact, saveAccount, saveContract, saveDeal } from "@/actions/sales";
import { Field, inputCls, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import type { accounts, contracts, deals } from "@/db/schema";
import { ACCOUNT_TYPE, BILLING_PERIOD, CONTRACT_STATUS, DEAL_STAGE } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";

type Account = typeof accounts.$inferSelect;
type Deal = typeof deals.$inferSelect;
type Contract = typeof contracts.$inferSelect;
type Opt = { id: string; name: string };

export function AccountFormButton({ a, users, trigger = "+ Cuenta", triggerClass, defaultOpen }: { a?: Account; users: Opt[]; trigger?: string; triggerClass?: string; defaultOpen?: boolean }) {
  return (
    <Modal trigger={trigger} title={a ? `Editar ${a.name}` : "Nueva cuenta"} triggerClass={triggerClass} defaultOpen={defaultOpen}>
      <ActionForm action={saveAccount}>
        {a && <input type="hidden" name="id" value={a.id} />}
        <Field label="Nombre"><input name="name" required defaultValue={a?.name} className={inputCls} placeholder="Clínica Serena" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo"><Select name="type" defaultValue={a?.type ?? "clinic"} options={Object.entries(ACCOUNT_TYPE)} /></Field>
          <Field label="Ciudad"><input name="city" defaultValue={a?.city ?? ""} className={inputCls} placeholder="Guadalajara" /></Field>
          <Field label="Terapeutas"><input name="therapistsCount" type="number" min={0} defaultValue={a?.therapistsCount ?? ""} className={inputCls} /></Field>
          <Field label="Responsable"><Select name="ownerId" defaultValue={a?.ownerId} placeholder="Sin asignar" options={users.map((u) => [u.id, u.name])} /></Field>
        </div>
        <Field label="Sitio web"><input name="website" type="url" defaultValue={a?.website ?? ""} className={inputCls} placeholder="https://" /></Field>
        <Field label="Notas"><textarea name="notes" rows={3} defaultValue={a?.notes ?? ""} className={inputCls} /></Field>
        <Submit>{a ? "Guardar" : "Crear cuenta"}</Submit>
      </ActionForm>
      {a && (
        <div className="mt-3 border-t border-line pt-3">
          <DeleteButton kind="account" id={a.id} what={`la cuenta ${a.name}`} redirectTo="/sales" label="Eliminar cuenta"
            warning="También se borran sus oportunidades, contratos y seguimientos. Las personas se quedan en Contactos." />
        </div>
      )}
    </Modal>
  );
}

export function ContactFormButton({ accountId, triggerClass }: { accountId: string; triggerClass?: string }) {
  return (
    <Modal trigger="+ Contacto" title="Agregar contacto a la cuenta" triggerClass={triggerClass}>
      <ActionForm action={addAccountContact}>
        <input type="hidden" name="accountId" value={accountId} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input name="name" required className={inputCls} /></Field>
          <Field label="Puesto"><input name="title" className={inputCls} placeholder="Directora clínica" /></Field>
          <Field label="Correo"><input name="email" type="email" required className={inputCls} /></Field>
          <Field label="Teléfono / WhatsApp"><input name="phone" className={inputCls} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="decisionMaker" className="h-4 w-4 accent-[#059669]" /> Toma la decisión de compra</label>
        <p className="text-[11px] text-faint">Se guarda en Contactos. Agregarlo no le da permiso para recibir campañas.</p>
        <Submit>Agregar</Submit>
      </ActionForm>
    </Modal>
  );
}

export function DealFormButton({
  d, accounts: accs, accountId, users, trigger = "+ Oportunidad", triggerClass, defaultOpen,
}: { d?: Deal; accounts?: Opt[]; accountId?: string; users: Opt[]; trigger?: React.ReactNode; triggerClass?: string; defaultOpen?: boolean }) {
  return (
    <Modal trigger={trigger} title={d ? d.name : "Nueva oportunidad"} triggerClass={triggerClass} defaultOpen={defaultOpen}>
      <ActionForm action={saveDeal}>
        {d && <input type="hidden" name="id" value={d.id} />}
        {d || accountId ? (
          <input type="hidden" name="accountId" value={d?.accountId ?? accountId} />
        ) : (
          <Field label="Cuenta" hint={accs?.length ? undefined : "Primero crea la cuenta."}><Select name="accountId" placeholder="Elige…" options={(accs ?? []).map((a) => [a.id, a.name])} /></Field>
        )}
        <Field label="Nombre"><input name="name" required defaultValue={d?.name} className={inputCls} placeholder="Piloto 10 licencias" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Etapa"><Select name="stage" defaultValue={d?.stage ?? "prospect"} options={Object.entries(DEAL_STAGE).map(([k, v]) => [k, v.label])} /></Field>
          <Field label="Licencias"><input name="seats" type="number" min={0} defaultValue={d?.seats ?? ""} className={inputCls} /></Field>
          <Field label="Monto estimado (MXN)"><input name="amountMxn" type="number" min={0} defaultValue={d?.amountMxn ?? ""} className={inputCls} /></Field>
          <Field label="Cobro"><Select name="billingPeriod" defaultValue={d?.billingPeriod ?? "monthly"} options={Object.entries(BILLING_PERIOD)} /></Field>
          <Field label="Cierre esperado"><input name="expectedCloseOn" type="date" defaultValue={d?.expectedCloseOn ?? ""} className={inputCls} /></Field>
          <Field label="Responsable"><Select name="ownerId" defaultValue={d?.ownerId} placeholder="Yo" options={users.map((u) => [u.id, u.name])} /></Field>
        </div>
        <Field label="Si se perdió, ¿por qué?"><input name="lostReason" defaultValue={d?.lostReason ?? ""} className={inputCls} placeholder="Precio, eligieron otro sistema, sin presupuesto…" /></Field>
        <Field label="Notas"><textarea name="notes" rows={3} defaultValue={d?.notes ?? ""} className={inputCls} /></Field>
        <Submit>{d ? "Guardar" : "Crear"}</Submit>
        <p className="text-[11px] text-faint">Al marcarla como ganada se crea el borrador del contrato.</p>
      </ActionForm>
      {d && (
        <div className="mt-3 border-t border-line pt-3">
          <DeleteButton kind="deal" id={d.id} what={`la oportunidad "${d.name}"`} warning="Si tiene contrato, el contrato se queda sin el enlace." label="Eliminar oportunidad" />
        </div>
      )}
    </Modal>
  );
}

export function ContractFormButton({ c, accountId, trigger = "+ Contrato", triggerClass }: { c?: Contract; accountId: string; trigger?: React.ReactNode; triggerClass?: string }) {
  return (
    <Modal trigger={trigger} title={c ? `CTR-${c.number} · ${c.title}` : "Nuevo contrato"} triggerClass={triggerClass} wide>
      <ActionForm action={saveContract}>
        {c && <input type="hidden" name="id" value={c.id} />}
        <input type="hidden" name="accountId" value={accountId} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Título" className="col-span-2 sm:col-span-3"><input name="title" required defaultValue={c?.title} className={inputCls} placeholder="Licencias Ziora 2027" /></Field>
          <Field label="Estado"><Select name="status" defaultValue={c?.status ?? "draft"} options={Object.entries(CONTRACT_STATUS).map(([k, v]) => [k, v.label])} /></Field>
          <Field label="Licencias"><input name="seats" type="number" min={0} defaultValue={c?.seats ?? ""} className={inputCls} /></Field>
          <Field label="Precio por licencia (MXN)"><input name="pricePerSeatMxn" type="number" min={0} defaultValue={c?.pricePerSeatMxn ?? ""} className={inputCls} /></Field>
          <Field label="Monto por periodo (MXN)" hint="Vacío = licencias × precio."><input name="amountMxn" type="number" min={0} defaultValue={c?.amountMxn || ""} className={inputCls} /></Field>
          <Field label="Cobro"><Select name="billingPeriod" defaultValue={c?.billingPeriod ?? "monthly"} options={Object.entries(BILLING_PERIOD)} /></Field>
          <Field label="Inicio"><input name="startsOn" type="date" defaultValue={c?.startsOn ?? ""} className={inputCls} /></Field>
          <Field label="Fin"><input name="endsOn" type="date" defaultValue={c?.endsOn ?? ""} className={inputCls} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoRenew" defaultChecked={c?.autoRenew} className="h-4 w-4 accent-[#059669]" /> Se renueva automáticamente</label>
        <Field label="Documento (PDF en Drive)"><input name="documentUrl" type="url" defaultValue={c?.documentUrl ?? ""} className={inputCls} placeholder="https://drive.google.com/…" /></Field>
        <Field label="Notas"><textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} className={inputCls} /></Field>
        <Submit>{c ? "Guardar" : "Crear contrato"}</Submit>
      </ActionForm>
      {c && (
        <div className="mt-3 border-t border-line pt-3">
          <DeleteButton kind="contract" id={c.id} what={`el contrato CTR-${c.number}`} label="Eliminar contrato" />
        </div>
      )}
    </Modal>
  );
}
