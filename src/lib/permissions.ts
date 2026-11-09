/**
 * Permisos por rol funcional. Módulo puro (sin base de datos) para poder probarlo.
 * La carga de roles de la persona en sesión está en src/lib/session.ts (requireAccess).
 */
import type { opsRoleEnum } from "@/db/schema";

export type OpsRole = (typeof opsRoleEnum.enumValues)[number];

export const ALL_ROLES: OpsRole[] = ["ceo", "sales", "clinical_director", "marketing", "operations", "dev_qa"];

/** Quién puede hacer qué. Un admin de Event Ops puede todo. */
export const PERMISSIONS = {
  "team.manage": ["ceo", "operations"],
  "content.manage": ["marketing", "ceo", "operations"],
  "content.review": ["clinical_director", "ceo"],
  "content.suggest": ALL_ROLES,
  "suggestions.decide": ["marketing", "ceo"],
  "sales.manage": ["sales", "ceo"],
  "sales.view": ["sales", "ceo", "operations", "clinical_director"],
  "followups.manage": ["clinical_director", "sales", "ceo", "operations"],
  "tickets.create": ALL_ROLES,
  "tickets.triage": ["dev_qa", "ceo"],
  "customers.view": ["ceo", "sales", "clinical_director", "operations", "dev_qa"],
  "revenue.view": ["ceo", "sales", "operations"],
  "analytics.view": ["marketing", "ceo", "operations", "sales"],
  "integrations.manage": ["dev_qa", "operations", "ceo"],
} as const satisfies Record<string, readonly OpsRole[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Revisores de contenido. Basta UNA aprobación: la del director clínico o, si él no puede, la del CEO.
 * La segunda es opcional.
 */
export const CONTENT_REVIEWER_ROLES: OpsRole[] = ["clinical_director", "ceo"];

export type Access = { isAdmin: boolean; roles: OpsRole[] };

export function can(access: Access, permission: Permission): boolean {
  if (access.isAdmin) return true;
  const allowed: readonly OpsRole[] = PERMISSIONS[permission];
  return access.roles.some((r) => allowed.includes(r));
}
