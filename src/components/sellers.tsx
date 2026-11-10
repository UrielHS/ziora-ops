"use client";

import { saveSellerProfileAction } from "@/actions/sellers";
import type { SellerProfile } from "@/db/schema";
import { Field, inputCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ui/form";

/** Ajustes → «Mi perfil de vendedor». Tres ligas que después aparecen en la ficha de cada lead como «Mis ligas». */
export function SellerProfileForm({ profile }: { profile: SellerProfile | null }) {
  return (
    <ActionForm action={saveSellerProfileAction} className="flex flex-col gap-3 px-5 pb-5">
      <Field label="Mi liga de referido" hint="La de tu cuenta de Ziora (Referidos). Con ella se cuentan tus registros.">
        <input name="referralUrl" type="url" defaultValue={profile?.referralUrl ?? ""} placeholder="https://ziora-copilot.com/r/TU-CODIGO" className={inputCls} />
      </Field>
      <Field label="Mi liga de calendario" hint="Página de reservas de Google Calendar para que el lead elija hora.">
        <input name="bookingUrl" type="url" defaultValue={profile?.bookingUrl ?? ""} placeholder="https://calendar.app.google/…" className={inputCls} />
      </Field>
      <Field label="Mi código de descuento" hint="Lo crea Chris en Stripe. Mayúsculas, sin espacios.">
        <input name="discountCode" defaultValue={profile?.discountCode ?? ""} placeholder="EURI20" className={inputCls} />
      </Field>
      <div><Submit>Guardar</Submit></div>
    </ActionForm>
  );
}
