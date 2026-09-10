/**
 * Customer field policy for incoming public inquiries.
 *
 * A returning visitor must never silently rewrite the customer record an
 * administrator curates. A later inquiry may only fill fields that are still
 * empty; anything already populated is left exactly as it is. The visitor's own
 * submission is preserved in full on the Inquiry snapshot regardless, so no
 * information is lost by declining to overwrite here.
 *
 * `normalizedEmail` is the customer's identity and is never an input to this
 * function: it is set once when the record is created and never rewritten by a
 * submission.
 *
 * Pure and free of Prisma and `server-only` imports so the policy itself is
 * unit-testable without a database.
 */

/** Contact fields a later inquiry is allowed to fill in when they are blank. */
export const FILLABLE_CUSTOMER_FIELDS = [
  "name",
  "phone",
  "whatsapp",
  "company",
] as const;

export type FillableCustomerField = (typeof FILLABLE_CUSTOMER_FIELDS)[number];

export type CustomerContactFields = Partial<
  Record<FillableCustomerField, string | null | undefined>
>;

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * Returns only the fields that should be written to an existing customer.
 *
 * A field is included when the stored value is blank and the submission
 * provides a usable one. An empty result means the submission changes nothing
 * about the current customer, which is the common case for a repeat client.
 */
export function fillMissingCustomerFields(
  existing: CustomerContactFields,
  submitted: CustomerContactFields,
): Partial<Record<FillableCustomerField, string>> {
  const fill: Partial<Record<FillableCustomerField, string>> = {};

  for (const field of FILLABLE_CUSTOMER_FIELDS) {
    const incoming = submitted[field];
    if (isBlank(existing[field]) && !isBlank(incoming)) {
      fill[field] = (incoming as string).trim();
    }
  }

  return fill;
}
