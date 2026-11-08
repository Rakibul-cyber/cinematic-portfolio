import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DATABASE_IDENTITY_SQL,
  DIAGNOSTIC_VERSION,
  lookupDatabaseIdentity,
  neonEndpoint,
} from "./database-identity";

// Fictional values only.
const POOLED =
  "postgresql://fictional_user:fictional-secret@ep-fictional-name-a1b2c3d4-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
  "postgresql://fictional_user:fictional-secret@ep-fictional-name-a1b2c3d4.eu-central-1.aws.neon.tech/neondb?sslmode=require";

describe("DATABASE_IDENTITY_SQL", () => {
  // Regression: production logged "Failed to deserialize column of type
  // 'name'" for the uncast current_database()/current_schema() query.
  it("casts every selected column to text", () => {
    for (const column of [
      "database",
      "schema",
      "category_id_nullable",
      "latest_migration",
    ]) {
      assert.match(DATABASE_IDENTITY_SQL, new RegExp(`::text(\\s|\\S)*? AS ${column}\\b`));
    }
    assert.match(DATABASE_IDENTITY_SQL, /current_database\(\)::text AS database\b/);
    assert.match(DATABASE_IDENTITY_SQL, /current_schema\(\)::text AS schema\b/);
  });

  it("is one parameterless read", () => {
    assert.match(DATABASE_IDENTITY_SQL, /^SELECT\b/);
    assert.doesNotMatch(
      DATABASE_IDENTITY_SQL,
      /\$\d|;|\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|SET)\b/i,
    );
  });

  it("is stamped with a diagnostic version", () => {
    assert.equal(DIAGNOSTIC_VERSION, 3);
  });
});

describe("neonEndpoint", () => {
  it("reads the endpoint id of a pooled and a direct host", () => {
    assert.deepEqual(neonEndpoint(POOLED), {
      endpointId: "ep-fictional-name-a1b2c3d4",
      pooled: true,
    });
    assert.deepEqual(neonEndpoint(DIRECT), {
      endpointId: "ep-fictional-name-a1b2c3d4",
      pooled: false,
    });
  });

  it("handles current Neon hostname shapes", () => {
    // Same shape as the production endpoint id (adjective-noun-8 chars);
    // cell-prefixed (c-2) and Azure hosts are also issued by Neon.
    const id = "ep-quiet-river-q1w2e3r4";
    for (const [host, pooled] of [
      [`${id}-pooler.us-east-2.aws.neon.tech`, true],
      [`${id}.us-east-2.aws.neon.tech`, false],
      [`${id}-pooler.c-2.us-east-2.aws.neon.tech`, true],
      [`${id}-pooler.eastus2.azure.neon.tech`, true],
    ] as const) {
      assert.deepEqual(
        neonEndpoint(`postgresql://u:p@${host}/neondb?sslmode=require&channel_binding=require`),
        { endpointId: id, pooled },
        host,
      );
    }
  });

  it("returns nothing for a non-Neon or malformed URL", () => {
    const none = { endpointId: null, pooled: null };
    assert.deepEqual(neonEndpoint("postgresql://u:p@db.example.invalid/x"), none);
    assert.deepEqual(neonEndpoint("not a url"), none);
    assert.deepEqual(neonEndpoint(undefined), none);
  });
});

describe("lookupDatabaseIdentity", () => {
  it("runs the identity SQL and keeps validated values", async () => {
    const seen: string[] = [];
    const identity = await lookupDatabaseIdentity(POOLED, async (sql) => {
      seen.push(sql);
      return [
        {
          database: "neondb",
          schema: "public",
          category_id_nullable: "YES",
          latest_migration: "20261107200000_make_project_category_optional",
        },
      ];
    });
    assert.deepEqual(seen, [DATABASE_IDENTITY_SQL]);
    assert.deepEqual(identity, {
      endpointId: "ep-fictional-name-a1b2c3d4",
      pooled: true,
      database: "neondb",
      schema: "public",
      categoryIdNullable: "YES",
      latestMigration: "20261107200000_make_project_category_optional",
    });
  });

  it("drops unexpected values", async () => {
    const identity = await lookupDatabaseIdentity(POOLED, async () => [
      {
        database: "neondb; DROP",
        schema: 42,
        category_id_nullable: "maybe",
        latest_migration: "visitor@example.com",
      },
    ]);
    assert.equal(identity.database, null);
    assert.equal(identity.schema, null);
    assert.equal(identity.categoryIdNullable, null);
    assert.equal(identity.latestMigration, null);
  });

  it("reports a failed lookup with only its SQLSTATE", async () => {
    const identity = await lookupDatabaseIdentity(POOLED, async () => {
      throw Object.assign(new Error(`relation "x" at ${POOLED}`), { code: "42P01" });
    });
    assert.equal(identity.identityLookupFailed, true);
    assert.equal(identity.identityErrorCode, "42P01");
    assert.equal(identity.endpointId, "ep-fictional-name-a1b2c3d4");
  });

  it("never exposes credentials or the host", async () => {
    const identity = await lookupDatabaseIdentity(POOLED, async () => [{}]);
    const text = JSON.stringify(identity);
    for (const secret of ["fictional-secret", "fictional_user", "aws.neon.tech", "sslmode"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });
});
