import { isValidElement, type ReactNode } from "react";

/**
 * Whether a legal document may be published, decided fail-closed.
 *
 * A document is publishable only when it carries an explicit, well-formed
 * approval record *and* contains no unfinished facts. Removing every TODO is
 * not enough on its own, and an approval cannot hide a TODO that remains, so
 * neither safeguard has to be dismantled when the final text arrives: filling
 * in the facts and recording the approval is what releases the page.
 */

/** Who approved the final text, and on which day (YYYY-MM-DD). */
export type LegalApproval = { approvedOn: string; approvedBy: string };

export type LegalDocumentStatusInput = {
  /** The rendered sections' content, as authored. */
  content: ReactNode[];
  approval: LegalApproval | null;
  /** The component that marks a missing fact (`LegalTodo`). */
  todoMarker: unknown;
};

const RAW_TODO = /\[\s*TODO\b/i;

/**
 * Counts unfinished facts by walking the authored element tree: every marker
 * element, plus any text that still reads "[TODO", so a hand-typed placeholder
 * is caught too. Legal content is plain markup, so `children` reaches all of it.
 */
export function legalTodoCount(node: ReactNode, todoMarker: unknown): number {
  if (node === null || node === undefined || typeof node === "boolean") return 0;
  if (typeof node === "string") return RAW_TODO.test(node) ? 1 : 0;
  if (typeof node === "number" || typeof node === "bigint") return 0;
  if (Array.isArray(node)) return node.reduce((sum: number, child: ReactNode) => sum + legalTodoCount(child, todoMarker), 0);
  if (isValidElement(node)) {
    if (node.type === todoMarker) return 1;
    return legalTodoCount((node.props as { children?: ReactNode }).children, todoMarker);
  }
  return 0;
}

/** A real calendar date in YYYY-MM-DD form, and a named approver. */
export function isValidLegalApproval(approval: LegalApproval | null | undefined): approval is LegalApproval {
  if (!approval) return false;
  const { approvedOn, approvedBy } = approval;
  if (typeof approvedBy !== "string" || approvedBy.trim().length === 0) return false;
  if (typeof approvedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(approvedOn)) return false;
  const date = new Date(`${approvedOn}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(approvedOn);
}

const DRAFT_TITLE_SUFFIX = { de: " – Entwurf", en: " – draft" } as const;

/**
 * A legal page's metadata title: the base title, marked as a draft in the
 * page's language while `draft` holds, and plain once it does not. `draft`
 * comes from the same decision as everything else (`legalDraftReasons`).
 */
export function draftAwareTitle(title: string, language: "de" | "en", draft: boolean): string {
  return draft ? `${title}${DRAFT_TITLE_SUFFIX[language]}` : title;
}

/** Every reason the document is still a draft; empty only when publishable. */
export function legalDraftReasons({ content, approval, todoMarker }: LegalDocumentStatusInput): string[] {
  const reasons: string[] = [];
  const todos = content.reduce((sum: number, node) => sum + legalTodoCount(node, todoMarker), 0);
  if (todos > 0) reasons.push(`${todos} unfinished TODO ${todos === 1 ? "item" : "items"}`);
  if (!isValidLegalApproval(approval)) reasons.push("no valid approval record (approvedOn YYYY-MM-DD and approvedBy)");
  return reasons;
}
