"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { upsertSellerProfile } from "@/domain/sellers";
import { formAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";

const httpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(500);

// Cada quien edita solo su perfil: el user_id sale de la sesión, nunca del formulario.
const _saveSellerProfile = formAction(
  z.object({
    referralUrl: httpsUrl.optional(),
    bookingUrl: httpsUrl.optional(),
    discountCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, "solo letras, números y guiones (3 a 32)").optional(),
  }),
  async (d) => {
    const user = await requireUser();
    await upsertSellerProfile(db, user.id, { referralUrl: d.referralUrl ?? null, bookingUrl: d.bookingUrl ?? null, discountCode: d.discountCode ?? null });
    revalidatePath("/settings");
    revalidatePath("/leads", "layout");
    return "Perfil guardado";
  },
);

export async function saveSellerProfileAction(prev: ActionState, fd: FormData) {
  return _saveSellerProfile(prev, fd);
}
