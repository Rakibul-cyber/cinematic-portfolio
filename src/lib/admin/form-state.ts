import type { z } from "zod";

/**
 * What an admin save action returns when it cannot save.
 *
 * Only a message and the name of the offending field. The submitted values are
 * never sent back: the browser still has them (see `AdminForm`), so nothing the
 * editor typed travels into a URL, a response, or a log.
 */
export type AdminFormState = { error: string; field?: string } | null;

type Issue = {
  code: string;
  path: PropertyKey[];
  message: string;
  origin?: string;
  format?: string;
  expected?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
};

/**
 * Turns the first validation issue into a plain-language message for the
 * field it concerns. Schema-authored messages (slug format, video pairs) are
 * kept; Zod's generic defaults are replaced.
 */
export function describeValidationError(error: z.ZodError): NonNullable<AdminFormState> {
  const issue = error.issues[0] as Issue | undefined;
  if (!issue) return { error: "Check the form fields." };
  const field = typeof issue.path[0] === "string" ? issue.path[0] : undefined;
  return field ? { error: messageFor(issue), field } : { error: messageFor(issue) };
}

function messageFor(issue: Issue): string {
  const numeric = issue.origin === "number";
  switch (issue.code) {
    case "too_big":
      return numeric ? `Use a number no greater than ${issue.maximum}.` : `Use ${issue.maximum} characters or fewer.`;
    case "too_small":
      if (numeric) return `Use a number no less than ${issue.minimum}.`;
      return Number(issue.minimum) <= 1 ? "This field is required." : `Use at least ${issue.minimum} characters.`;
    case "invalid_type":
      return issue.expected === "number" || issue.expected === "int" ? "Enter a whole number." : "This field is required.";
    case "invalid_value":
      return "Choose one of the listed options.";
    case "invalid_format":
      if (issue.format === "email") return "Enter a valid email address.";
      if (issue.format === "url") return "Enter a full URL, including https://.";
      if (issue.format === "uuid") return "Choose one of the listed options.";
      return issue.message;
    case "custom":
      return issue.message;
    default:
      return "Check this field.";
  }
}
