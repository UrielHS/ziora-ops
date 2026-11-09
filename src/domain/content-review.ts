import { CONTENT_REVIEWER_ROLES, type OpsRole } from "@/lib/permissions";

export type ReviewInput = { reviewerId: string; reviewerRoles: OpsRole[]; decision: "approved" | "changes_requested" };

export type ReviewSummary = {
  approvedRoles: OpsRole[];
  missingRoles: OpsRole[];
  changesRequested: boolean;
  /** Aprobó el director clínico o el CEO, y nadie tiene cambios pendientes. */
  complete: boolean;
};

/**
 * Basta una aprobación de cualquiera de los revisores (director clínico o, si no puede, CEO); la otra es opcional.
 * Una petición de cambios bloquea la pieza hasta que quien la pidió apruebe.
 * missingRoles queda vacío al estar aprobada; si no, indica el revisor principal (director clínico).
 */
export function summarizeReviews(reviews: ReviewInput[], reviewers: OpsRole[] = CONTENT_REVIEWER_ROLES): ReviewSummary {
  const approvedRoles = reviewers.filter((role) =>
    reviews.some((r) => r.decision === "approved" && r.reviewerRoles.includes(role)),
  );
  const approved = approvedRoles.length > 0;
  const missingRoles = approved ? [] : reviewers.slice(0, 1);
  const changesRequested = reviews.some((r) => r.decision === "changes_requested");
  return { approvedRoles, missingRoles, changesRequested, complete: approved && !changesRequested };
}

/**
 * Estados que exigen checklist legal y revisión completa. "Programado" ya no: marketing puede programar
 * antes de la revisión y la pieza se ve en el calendario con la etiqueta "Sin revisar" hasta que la apruebe el director clínico (o el CEO).
 */
export const PUBLISHABLE_STATUSES = new Set(["approved", "published"]);

/** Estados en los que una pieza puede estar esperando revisión. */
export const REVIEWABLE_STATUSES = new Set(["legal_review", "scheduled"]);

/** Si cambia lo que el público verá, las aprobaciones anteriores ya no valen. */
export function contentChanged(
  before: { title: string; copy: string | null; assetUrl: string | null },
  after: { title: string; copy: string | null; assetUrl: string | null },
) {
  return before.title !== after.title || (before.copy ?? "") !== (after.copy ?? "") || (before.assetUrl ?? "") !== (after.assetUrl ?? "");
}
