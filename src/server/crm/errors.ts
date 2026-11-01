import { Prisma } from "@/generated/prisma/client";

/** A submitted service that no longer exists. Its message is fixed, safe text. */
export class InvalidServiceError extends Error {}

/**
 * Expected failures when an administrator edits a customer.
 *
 * Kept apart from the service so the translation can be tested without a
 * database. Messages are fixed text: the database error is never passed on,
 * because it names constraints and columns and may carry another customer's
 * identifiers.
 */
export class CustomerUpdateError extends Error {
  constructor(
    message: string,
    readonly field?: "email",
  ) {
    super(message);
    this.name = "CustomerUpdateError";
  }
}

/** Maps the database errors an ordinary customer edit can hit; anything else is rethrown unchanged. */
export function translateCustomerUpdateError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // `normalizedEmail` is the only unique column the edit writes.
    if (error.code === "P2002")
      throw new CustomerUpdateError("Another customer already uses this email address.", "email");
    // The update only matches a customer that is not anonymized.
    if (error.code === "P2025")
      throw new CustomerUpdateError("This customer was anonymized or removed. Reload the page.");
  }
  throw error;
}
