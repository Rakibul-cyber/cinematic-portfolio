import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, describe, it } from "node:test";

/**
 * Runs the real `anonymizeCustomer` against a fake client placed in the slot
 * `src/server/db/prisma.ts` reuses, so no database client is ever created.
 */

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = { id: "actor", name: "Actor", email: "actor@example.test", role: "SUPER_ADMIN" as const };

/** Inquiry text columns that identify nothing about the visitor. */
const RETAINED_INQUIRY_TEXT = ["id", "submissionToken", "customerId", "serviceId", "serviceNameSnapshot"];

type Writes = { customer: unknown[]; inquiry: Array<{ data: Record<string, unknown> }>; note: unknown[]; audit: Array<{ data: Record<string, unknown> }> };
let writes: Writes;
let alreadyAnonymized: Date | null;
let anonymizeCustomer: typeof import("@/server/privacy/service").anonymizeCustomer;

before(async () => {
  const client = {
    $transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({
        customer: {
          findUniqueOrThrow: async () => ({ anonymizedAt: alreadyAnonymized }),
          update: async (input: unknown) => { writes.customer.push(input); },
        },
        inquiry: { updateMany: async (input: Writes["inquiry"][number]) => { writes.inquiry.push(input); } },
        customerNote: { updateMany: async (input: unknown) => { writes.note.push(input); } },
      }),
    auditLog: { create: async (input: Writes["audit"][number]) => { writes.audit.push(input); } },
  };
  (globalThis as unknown as { cinematicPortfolioPrisma: unknown }).cinematicPortfolioPrisma = client;
  ({ anonymizeCustomer } = await import("@/server/privacy/service"));
});

beforeEach(() => {
  writes = { customer: [], inquiry: [], note: [], audit: [] };
  alreadyAnonymized = null;
});

describe("privacy anonymization", () => {
  it("clears the free-text budget label along with the other inquiry identifiers", async () => {
    assert.deepEqual(await anonymizeCustomer(CUSTOMER_ID, ACTOR), { changed: true });
    const { data } = writes.inquiry[0]!;
    assert.equal(data.budgetLabel, null);
    assert.equal(data.location, null);
    assert.equal(data.referralSource, null);
    assert.equal(data.projectType, "[Removed during privacy anonymization]");
    assert.equal(data.message, "[Removed during privacy anonymization]");
    assert.ok(data.anonymizedAt instanceof Date);
  });

  it("clears every visitor-supplied text column of the inquiry model, including any added later", async () => {
    await anonymizeCustomer(CUSTOMER_ID, ACTOR);
    const schema = await readFile("prisma/schema.prisma", "utf8");
    const model = /model Inquiry \{([\s\S]*?)\n\}/.exec(schema)![1]!;
    const textColumns = [...model.matchAll(/^\s*(\w+)\s+String\??(?:\s|$)/gm)].map((match) => match[1]!);
    assert.ok(textColumns.includes("budgetLabel"), "the schema parse found the field");
    for (const column of textColumns) {
      if (RETAINED_INQUIRY_TEXT.includes(column)) continue;
      assert.ok(column in writes.inquiry[0]!.data, `${column} must be anonymized, or listed as retained with a reason`);
    }
  });

  it("preserves operational records: status, dates, relations and the service snapshot are not touched", async () => {
    await anonymizeCustomer(CUSTOMER_ID, ACTOR);
    for (const column of ["status", "createdAt", "projectDate", "serviceId", "serviceNameSnapshot", "customerId", "submissionToken"]) {
      assert.ok(!(column in writes.inquiry[0]!.data), `${column} is retained`);
    }
  });

  it("records an audit entry with identifiers and the operation only", async () => {
    await anonymizeCustomer(CUSTOMER_ID, ACTOR);
    assert.equal(writes.audit.length, 1);
    assert.equal(writes.audit[0]!.data.entityId, CUSTOMER_ID);
    assert.deepEqual(writes.audit[0]!.data.metadata, { operation: "anonymize" });
  });

  it("changes and audits nothing when the customer is already anonymized", async () => {
    alreadyAnonymized = new Date();
    assert.deepEqual(await anonymizeCustomer(CUSTOMER_ID, ACTOR), { changed: false });
    assert.deepEqual(writes, { customer: [], inquiry: [], note: [], audit: [] });
  });

  it("stays one update inside the existing transaction", async () => {
    const source = await readFile("src/server/privacy/service.ts", "utf8");
    assert.equal((source.match(/tx\.inquiry\.updateMany/g) ?? []).length, 1);
  });
});
