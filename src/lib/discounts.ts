/**
 * Códigos de descuento generales de ventas. Son cupones LIVE en Stripe (creados el 10-nov-2026):
 * porcentaje sobre el primer cobro (un mes del plan mensual o todo el periodo prepagado), sin caducidad.
 * El cliente los teclea en la página de pago de Stripe. Cambiar aquí solo cambia lo que ve el vendedor.
 */
export const DISCOUNT_CODES = [
  { code: "ZIORA5", label: "5 % de descuento en el primer cobro" },
  { code: "ZIORA10", label: "10 % de descuento en el primer cobro" },
  { code: "ZIORA15", label: "15 % de descuento en el primer cobro" },
] as const;
