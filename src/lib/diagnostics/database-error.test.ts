import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeDatabaseError } from "./database-error";

class PrismaClientKnownRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public meta: unknown,
  ) {
    super(message);
  }
}

function adapterError(cause: Record<string, unknown>, code: string) {
  return new PrismaClientKnownRequestError("Invalid invocation", code, {
    modelName: "Project",
    driverAdapterError: { name: "DriverAdapterError", cause },
  });
}

describe("describeDatabaseError", () => {
  it("recovers the column and relation of a not-null violation", () => {
    const error = adapterError(
      {
        kind: "NullConstraintViolation",
        originalCode: "23502",
        originalMessage:
          'null value in column "categoryId" of relation "project" violates not-null constraint',
      },
      "P2011",
    );
    assert.deepEqual(describeDatabaseError(error), {
      errorName: "PrismaClientKnownRequestError",
      prismaCode: "P2011",
      adapterKind: "NullConstraintViolation",
      sqlState: "23502",
      column: "categoryId",
      relation: "project",
      constraint: null,
    });
  });

  it("reads a named constraint", () => {
    const error = adapterError(
      {
        kind: "ForeignKeyConstraintViolation",
        originalCode: "23503",
        originalMessage:
          'insert or update on table "project" violates foreign key constraint "project_categoryId_fkey"',
      },
      "P2003",
    );
    const safe = describeDatabaseError(error);
    assert.equal(safe.constraint, "project_categoryId_fkey");
    assert.equal(safe.sqlState, "23503");
  });

  it("never returns submitted values from the message", () => {
    const secret = "visitor@example.com https://youtu.be/abc";
    const error = adapterError(
      {
        kind: "InvalidInputValue",
        originalCode: "22P02",
        originalMessage: `invalid input syntax for type uuid: "${secret}" column "${secret}"`,
      },
      "P2007",
    );
    const safe = describeDatabaseError(error);
    assert.ok(!JSON.stringify(safe).includes("example.com"));
    assert.ok(!JSON.stringify(safe).includes("youtu"));
    assert.equal(safe.column, null);
  });

  it("degrades to nulls for errors without driver details", () => {
    assert.deepEqual(describeDatabaseError(new TypeError("boom")), {
      errorName: "TypeError",
      prismaCode: null,
      adapterKind: null,
      sqlState: null,
      column: null,
      relation: null,
      constraint: null,
    });
    assert.equal(describeDatabaseError("text").errorName, "unknown");
  });
});
