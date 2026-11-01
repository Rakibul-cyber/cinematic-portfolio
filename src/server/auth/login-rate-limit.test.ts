import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, describe, it, mock } from "node:test";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError } from "better-auth/api";

import { GENERIC_SIGN_IN_ERROR, SIGN_IN_UNAVAILABLE_ERROR } from "@/lib/validation/auth";
import { createLoginGuard, type LoginGuardCategory, LOGIN_POLICIES, logLoginGuardEvent } from "@/server/auth/login-rate-limit";
import { runSignIn } from "@/server/auth/sign-in-workflow";
import { NETLIFY_CLIENT_IP_HEADER, rateLimitClientKey, UNKNOWN_CLIENT } from "@/server/security/client-ip";
import { bucketWindow, incrementBuckets, incrementBucketSql, pruneExpiredBucketsSql, rateLimitHmacKey, type BucketIncrement } from "@/server/security/rate-limit-buckets";

/**
 * Runs the real guard inside real Better Auth instances, over an in-memory
 * adapter and a fake counter store, so password verification, hook order, and the
 * HTTP route are all the library's own. Nothing here reaches Neon or any network.
 */

const BASE_URL = "http://localhost:3000";
const OWNER = "owner@example.test";
const PASSWORD = "sentinel-correct-password";
const WRONG = "sentinel-wrong-password";
const CLIENT = "192.0.2.10";
const HMAC_KEY = "k".repeat(32);
const ACCOUNT_LIMIT = LOGIN_POLICIES.account.limit;
const CLIENT_LIMIT = LOGIN_POLICIES.client.limit;

/** Shared counters, standing in for the one table every function instance uses. */
function fakeStore() {
  const rows = new Map<string, { scope: string; keyHash: string; count: number }>();
  const store = {
    rows,
    now: new Date("2026-11-01T10:01:00.000Z"),
    failing: false,
    increment: async (increments: BucketIncrement[]) => {
      if (store.failing) throw new Error(`postgres://user:sentinel-db-password@db.example.test/${OWNER}`);
      return increments.map(({ scope, keyHash, windowMs, now }) => {
        const key = `${scope}|${keyHash}|${bucketWindow(now, windowMs).windowStart.toISOString()}`;
        const row = rows.get(key) ?? { scope, keyHash, count: 0 };
        row.count += 1;
        rows.set(key, row);
        return row.count;
      });
    },
  };
  return store;
}

function instance(store: ReturnType<typeof fakeStore>, hmacKey: string | null = HMAC_KEY, libraryLogs = false) {
  const database = { user: [] as unknown[], account: [] as unknown[], session: [] as unknown[], verification: [] as unknown[] };
  const logs: LoginGuardCategory[] = [];
  const audits: unknown[] = [];
  const auth = betterAuth({
    secret: "s".repeat(32),
    baseURL: BASE_URL,
    trustedOrigins: [BASE_URL],
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true, disableSignUp: true },
    logger: { disabled: !libraryLogs, level: "debug" },
    hooks: {
      before: createLoginGuard({
        hmacKey: () => hmacKey,
        increment: store.increment,
        prune: async () => { throw new Error("prune is best-effort"); },
        now: () => store.now,
        log: (category) => { logs.push(category); },
        auditLimited: async (limits) => { audits.push(limits); },
      }),
    },
  });
  return { auth, database, logs, audits };
}

async function seedOwner(target: ReturnType<typeof instance>) {
  const context = await target.auth.$context;
  const now = new Date();
  target.database.user.push({ id: "owner-id", name: "Owner", email: OWNER, emailVerified: true, image: null, createdAt: now, updatedAt: now });
  target.database.account.push({ id: "account-id", userId: "owner-id", accountId: "owner-id", providerId: "credential", password: await context.password.hash(PASSWORD), createdAt: now, updatedAt: now });
}

function clientHeaders(ip: string | null = CLIENT, extra: Record<string, string> = {}): Headers {
  return new Headers({ ...(ip ? { [NETLIFY_CLIENT_IP_HEADER]: ip } : {}), ...extra });
}

/** The status one direct attempt ends in, as the Server Action path sees it. */
async function attempt(target: ReturnType<typeof instance>, email: string, password: string, headers = clientHeaders()): Promise<string> {
  try {
    await target.auth.api.signInEmail({ body: { email, password }, headers });
    return "OK";
  } catch (error) {
    assert.ok(error instanceof APIError);
    return String(error.status);
  }
}

function postSignIn(target: ReturnType<typeof instance>, email: string, password: string, headers: Record<string, string> = {}) {
  return target.auth.handler(new Request(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL, ...headers },
    body: JSON.stringify({ email, password }),
  }));
}

function workflow(target: ReturnType<typeof instance>, headers = clientHeaders()) {
  const audits: string[] = [];
  return {
    audits,
    dependencies: {
      signIn: (body: { email: string; password: string }) => target.auth.api.signInEmail({ body, headers }),
      auditSignedIn: async () => { audits.push("signed-in"); },
      auditFailed: async () => { audits.push("failed"); },
    },
  };
}

describe("administrator sign-in through the real auth library", () => {
  let store: ReturnType<typeof fakeStore>;
  let target: ReturnType<typeof instance>;

  before(() => { mock.method(console, "warn", () => {}); mock.method(console, "error", () => {}); });
  const fresh = async () => {
    store = fakeStore();
    target = instance(store);
    await seedOwner(target);
  };

  it("lets a valid administrator sign in, and sign out again", async () => {
    await fresh();
    const result = await target.auth.api.signInEmail({ body: { email: OWNER, password: PASSWORD }, headers: clientHeaders() });
    assert.equal(result.user.email, OWNER);
    assert.equal(target.database.session.length, 1);

    const response = await target.auth.handler(new Request(`${BASE_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json", cookie: `better-auth.session_token=${result.token}` },
      body: "{}",
    }));
    assert.equal(response.status, 200);
  });

  it("answers a wrong password and an unknown account identically", async () => {
    await fresh();
    const wrong = await runSignIn({ email: OWNER, password: WRONG }, workflow(target).dependencies);
    const unknown = await runSignIn({ email: "nobody@example.test", password: WRONG }, workflow(target).dependencies);
    assert.deepEqual(wrong, { ok: false, message: GENERIC_SIGN_IN_ERROR });
    assert.deepEqual(unknown, wrong);

    const wrongHttp = await postSignIn(target, OWNER, WRONG);
    const unknownHttp = await postSignIn(target, "nobody@example.test", WRONG);
    assert.equal(wrongHttp.status, 401);
    assert.equal(unknownHttp.status, 401);
    assert.equal(await wrongHttp.text(), await unknownHttp.text());
  });

  it("stops repeated attempts on one account, before any password check", async () => {
    await fresh();
    const context = await target.auth.$context;
    const verify = mock.method(context.password, "verify");
    const hash = mock.method(context.password, "hash");
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) assert.equal(await attempt(target, OWNER, WRONG), "UNAUTHORIZED");
    assert.equal(verify.mock.callCount(), ACCOUNT_LIMIT, "the spy sees every password check");
    assert.equal(await attempt(target, OWNER, PASSWORD), "TOO_MANY_REQUESTS", "even the right password waits");
    assert.equal(verify.mock.callCount(), ACCOUNT_LIMIT);
    assert.equal(hash.mock.callCount(), 0);
  });

  it("throttles an existing and an unknown account by the same rule", async () => {
    await fresh();
    const unknown = "nobody@example.test";
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      await attempt(target, OWNER, WRONG, clientHeaders(`198.51.100.${i}`));
      await attempt(target, unknown, WRONG, clientHeaders(`203.0.113.${i}`));
    }
    const owner = await postSignIn(target, OWNER, WRONG, { [NETLIFY_CLIENT_IP_HEADER]: "198.51.100.200" });
    const other = await postSignIn(target, unknown, WRONG, { [NETLIFY_CLIENT_IP_HEADER]: "203.0.113.200" });
    assert.equal(owner.status, 429);
    assert.equal(other.status, 429);
    assert.deepEqual(await owner.json(), await other.json());
    assert.equal(owner.headers.get("retry-after"), other.headers.get("retry-after"));
  });

  it("stops one client rotating through email addresses", async () => {
    await fresh();
    for (let i = 0; i < CLIENT_LIMIT; i += 1) assert.equal(await attempt(target, `rotate-${i}@example.test`, WRONG), "UNAUTHORIZED");
    assert.equal(await attempt(target, "rotate-final@example.test", WRONG), "TOO_MANY_REQUESTS");
    assert.equal(await attempt(target, OWNER, PASSWORD, clientHeaders("198.51.100.1")), "OK", "another client is unaffected");
  });

  it("stops distributed attempts on one account, across function instances", async () => {
    await fresh();
    const second = instance(store);
    await seedOwner(second);
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      const node = i % 2 === 0 ? target : second;
      assert.equal(await attempt(node, OWNER, WRONG, clientHeaders(`198.51.100.${i}`)), "UNAUTHORIZED");
    }
    assert.equal(await attempt(second, OWNER, WRONG, clientHeaders("198.51.100.99")), "TOO_MANY_REQUESTS");
    assert.equal(await attempt(target, OWNER, WRONG, clientHeaders("198.51.100.98")), "TOO_MANY_REQUESTS");
  });

  it("treats case and whitespace variants as one account", async () => {
    await fresh();
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) await attempt(target, i % 2 ? OWNER.toUpperCase() : OWNER, WRONG, clientHeaders(`198.51.100.${i}`));
    assert.equal(await attempt(target, ` ${OWNER} `.replace(/o/, "O"), WRONG, clientHeaders("198.51.100.99")), "TOO_MANY_REQUESTS");
  });

  it("allows exactly the limit through when requests arrive at once", async () => {
    await fresh();
    const results = await Promise.all(Array.from({ length: ACCOUNT_LIMIT + 10 }, (_, i) => attempt(target, OWNER, WRONG, clientHeaders(`198.51.100.${i}`))));
    assert.equal(results.filter((status) => status === "UNAUTHORIZED").length, ACCOUNT_LIMIT);
    assert.equal(results.filter((status) => status === "TOO_MANY_REQUESTS").length, 10);
  });

  it("releases a block when its window ends, however long the attempts continued", async () => {
    await fresh();
    for (let i = 0; i < ACCOUNT_LIMIT + 50; i += 1) await attempt(target, OWNER, WRONG, clientHeaders(`198.51.100.${i % 200}`));
    assert.equal(await attempt(target, OWNER, PASSWORD, clientHeaders("198.51.100.250")), "TOO_MANY_REQUESTS");

    store.now = new Date(bucketWindow(store.now, LOGIN_POLICIES.account.windowMs).windowEnd.getTime());
    assert.equal(await attempt(target, OWNER, PASSWORD, clientHeaders("198.51.100.250")), "OK");
  });

  it("announces how long a refused client should wait", async () => {
    await fresh();
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) await attempt(target, OWNER, WRONG, clientHeaders(`198.51.100.${i}`));
    const response = await postSignIn(target, OWNER, WRONG, { [NETLIFY_CLIENT_IP_HEADER]: "198.51.100.99" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), String(14 * 60));
  });

  it("refuses sign-in, and checks no password, when storage is unavailable", async () => {
    await fresh();
    store.failing = true;
    const context = await target.auth.$context;
    const verify = mock.method(context.password, "verify");
    assert.equal(await attempt(target, OWNER, PASSWORD), "SERVICE_UNAVAILABLE");
    assert.equal(verify.mock.callCount(), 0);
    assert.deepEqual(target.logs, ["limit_storage_failed"]);
    assert.equal((await postSignIn(target, OWNER, PASSWORD)).status, 503);
  });

  it("refuses sign-in when the pseudonymization secret is missing", async () => {
    store = fakeStore();
    target = instance(store, null);
    await seedOwner(target);
    assert.equal(await attempt(target, OWNER, PASSWORD), "SERVICE_UNAVAILABLE");
    assert.deepEqual(target.logs, ["limit_unconfigured"]);
    assert.equal(store.rows.size, 0);
  });

  it("gives the same visible answer for a limit and for a storage failure", async () => {
    await fresh();
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) await attempt(target, OWNER, WRONG, clientHeaders(`198.51.100.${i}`));
    const limited = workflow(target, clientHeaders("198.51.100.99"));
    assert.deepEqual(await runSignIn({ email: OWNER, password: PASSWORD }, limited.dependencies), { ok: false, message: SIGN_IN_UNAVAILABLE_ERROR });
    assert.deepEqual(limited.audits, [], "a refused attempt writes no row per request");

    store.failing = true;
    const failed = workflow(target, clientHeaders("198.51.100.98"));
    assert.deepEqual(await runSignIn({ email: OWNER, password: PASSWORD }, failed.dependencies), { ok: false, message: SIGN_IN_UNAVAILABLE_ERROR });
  });

  it("audits a limit once per window, without identifying the account", async () => {
    await fresh();
    for (let i = 0; i < ACCOUNT_LIMIT + 5; i += 1) await attempt(target, OWNER, WRONG, clientHeaders(`198.51.100.${i}`));
    assert.deepEqual(target.audits, [["account"]]);
  });

  it("does not bypass the account limit by spoofing forwarding headers", async () => {
    await fresh();
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      const spoofed = clientHeaders(`198.51.100.${i}`, { "x-forwarded-for": `203.0.113.${i}`, "x-real-ip": `203.0.113.${i}` });
      assert.equal(await attempt(target, OWNER, WRONG, spoofed), "UNAUTHORIZED");
    }
    assert.equal(await attempt(target, OWNER, WRONG, clientHeaders("198.51.100.99", { "x-forwarded-for": "203.0.113.99" })), "TOO_MANY_REQUESTS");
  });

  it("puts every request without a usable client address into one shared limit", async () => {
    await fresh();
    for (let i = 0; i < CLIENT_LIMIT; i += 1) {
      const headers = i % 2 ? clientHeaders(null, { "x-forwarded-for": `203.0.113.${i}` }) : clientHeaders(`not-an-ip-${i}`);
      assert.equal(await attempt(target, `shared-${i}@example.test`, WRONG, headers), "UNAUTHORIZED");
    }
    assert.equal(await attempt(target, "shared-final@example.test", WRONG, clientHeaders(null)), "TOO_MANY_REQUESTS");
  });

  it("counts a malformed body against the client, not as a free attempt", async () => {
    await fresh();
    for (let i = 0; i < CLIENT_LIMIT; i += 1) {
      const response = await target.auth.handler(new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL, [NETLIFY_CLIENT_IP_HEADER]: CLIENT },
        body: JSON.stringify({ email: 42, password: PASSWORD }),
      }));
      assert.notEqual(response.status, 200);
    }
    assert.equal((await postSignIn(target, OWNER, PASSWORD, { [NETLIFY_CLIENT_IP_HEADER]: CLIENT })).status, 429);
  });

  it("stores only hashes, never an address or an email", async () => {
    await fresh();
    await attempt(target, OWNER, PASSWORD);
    const stored = JSON.stringify([...store.rows.entries()]);
    assert.equal(store.rows.size, 2);
    for (const secret of [OWNER, CLIENT, PASSWORD]) assert.ok(!stored.includes(secret));
    for (const row of store.rows.values()) assert.match(row.keyHash, /^[0-9a-f]{64}$/);
  });

  it("leaves other auth endpoints alone", async () => {
    await fresh();
    for (let i = 0; i < 5; i += 1) assert.equal((await target.auth.handler(new Request(`${BASE_URL}/api/auth/get-session`, { headers: { origin: BASE_URL } }))).status, 200);
    assert.equal(store.rows.size, 0);
  });
});

describe("what the sign-in path writes to the logs", () => {
  afterEach(() => mock.restoreAll());

  it("contains no credential, address, email, or connection detail", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    mock.method(console, "warn", capture);
    mock.method(console, "error", capture);
    mock.method(console, "info", capture);
    mock.method(console, "log", capture);

    const store = fakeStore();
    const target = instance(store, HMAC_KEY, true);
    await seedOwner(target);
    const attemptHeaders = clientHeaders(CLIENT, { cookie: "session=sentinel-cookie", authorization: "Bearer sentinel-token" });
    const run = workflow(target, attemptHeaders);
    await runSignIn({ email: OWNER, password: WRONG }, run.dependencies);
    await runSignIn({ email: OWNER, password: PASSWORD }, {
      ...run.dependencies,
      signIn: async () => { throw new Error(`postgres://user:sentinel-db-password@db.example.test/${OWNER}`); },
    });
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) await runSignIn({ email: OWNER, password: WRONG }, run.dependencies);
    store.failing = true;
    await runSignIn({ email: OWNER, password: WRONG }, run.dependencies);
    for (const category of ["rate_limited", "limit_unconfigured", "limit_storage_failed"] as const) logLoginGuardEvent(category);

    assert.ok(lines.length > 0);
    const output = lines.join("\n");
    for (const secret of [OWNER, PASSWORD, WRONG, CLIENT, "sentinel-cookie", "sentinel-token", "sentinel-db-password", "db.example.test"]) {
      assert.ok(!output.includes(secret), `logged ${secret}`);
    }
  });
});

describe("client address handling", () => {
  const key = (value: string | null, extra: Record<string, string> = {}) => rateLimitClientKey(clientHeaders(value, extra));

  it("reads only the platform header", () => {
    assert.equal(key("192.0.2.1", { "x-forwarded-for": "203.0.113.1" }), "client:192.0.2.1");
    assert.equal(key(null, { "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.1", "cf-connecting-ip": "203.0.113.1" }), UNKNOWN_CLIENT);
    assert.equal(rateLimitClientKey(null), UNKNOWN_CLIENT);
  });

  it("does not accept anything other than exactly one address", () => {
    for (const value of ["192.0.2.1, 203.0.113.1", "unknown", "999.0.0.1", "192.0.2.1:443", "<script>"]) assert.equal(key(value), UNKNOWN_CLIENT, value);
  });

  it("groups an IPv6 subscriber by /64, however the address is written", () => {
    const expected = "client:2001:db8:1:2::/64";
    for (const value of ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:DB8:1:2::9", "2001:0db8:0001:0002::1", "2001:db8:1:2::1%eth0"]) assert.equal(key(value), expected, value);
    assert.equal(key("2001:db8:1:3::1"), "client:2001:db8:1:3::/64");
    assert.equal(key("::1"), "client:0:0:0:0::/64");
  });

  it("treats an IPv4-mapped address as the same client as its IPv4 form", () => {
    assert.equal(key("::ffff:192.0.2.1"), "client:192.0.2.1");
  });
});

describe("the pseudonymization key", () => {
  it("is required in production, and short values do not count", () => {
    assert.equal(rateLimitHmacKey({ NODE_ENV: "production" }), null);
    assert.equal(rateLimitHmacKey({ NODE_ENV: "production", RATE_LIMIT_HMAC_SECRET: "too-short" }), null);
    assert.equal(rateLimitHmacKey({ NODE_ENV: "production", RATE_LIMIT_HMAC_SECRET: HMAC_KEY }), HMAC_KEY);
    assert.ok(rateLimitHmacKey({ NODE_ENV: "development" }));
  });
});

/**
 * PostgreSQL's own behaviour for the real statements, through PGlite. PGlite has
 * one connection, so this proves the SQL and its arithmetic, not lock contention.
 * The package is a transitive dependency of Prisma's tooling, so the suite skips
 * rather than fails if it ever disappears.
 */
describe("the bucket statements on real PostgreSQL", async () => {
  const pglite = await import("@electric-sql/pglite").catch(() => null);
  const options = pglite ? {} : { skip: "PGlite is not installed" };

  async function database() {
    const db = new pglite!.PGlite();
    const migration = readFileSync("prisma/migrations/20260912090000_add_security_privacy/migration.sql", "utf8");
    await db.exec(migration.slice(migration.indexOf('CREATE TABLE "rate_limit_bucket"')));
    const client = { $queryRaw: async <T>(query: { text: string; values: unknown[] }) => (await db.query(query.text, query.values)).rows as T };
    return { db, client };
  }
  const increment = (now: Date, keyHash = "a".repeat(64)): BucketIncrement => ({ scope: LOGIN_POLICIES.account.scope, keyHash, windowMs: LOGIN_POLICIES.account.windowMs, now });

  it("counts atomically within a window and starts again in the next", options, async () => {
    const { db, client } = await database();
    const now = new Date("2026-11-01T10:01:00.000Z");
    const counts = await Promise.all(Array.from({ length: 10 }, () => incrementBuckets(client, [increment(now)])));
    assert.deepEqual(counts.flat().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(await incrementBuckets(client, [increment(new Date("2026-11-01T10:15:00.000Z"))]), [1]);
    await db.close();
  });

  it("removes only expired rows, in bounded batches", options, async () => {
    const { db, client } = await database();
    const old = new Date("2026-11-01T08:00:00.000Z");
    const now = new Date("2026-11-01T10:00:00.000Z");
    await incrementBuckets(client, [increment(old, "b".repeat(64)), increment(now, "c".repeat(64))]);
    const prune = pruneExpiredBucketsSql(now);
    await db.query(prune.text, prune.values);
    assert.match(prune.text, /LIMIT \$2/);
    const remaining = await db.query<{ keyHash: string }>('SELECT "keyHash" FROM "rate_limit_bucket"');
    assert.deepEqual(remaining.rows.map((row) => row.keyHash), ["c".repeat(64)]);
    await db.close();
  });

  it("keeps a statement's shape: one atomic upsert with no read before it", () => {
    const { text } = incrementBucketSql(increment(new Date()));
    assert.match(text, /ON CONFLICT \("scope", "keyHash", "windowStart"\) DO UPDATE/);
    assert.match(text, /RETURNING "count"/);
    assert.ok(!/SELECT/i.test(text));
  });
});

describe("separation from the rest of the application", () => {
  const source = (file: string) => readFileSync(file, "utf8");

  it("applies the guard on the configured auth instance, ahead of any password check", () => {
    const config = source("src/server/auth/config.ts");
    assert.match(config, /hooks: \{\s+before: createLoginGuard\(/);
    assert.match(config, /ipAddressHeaders: \[NETLIFY_CLIENT_IP_HEADER\]/);
    assert.match(config, /disableSignUp: true/);
    assert.ok(!/disableOriginCheck|disableCSRFCheck/.test(config), "origin protection stays on");
  });

  it("does not touch admin permissions", () => {
    for (const file of ["src/server/auth/session.ts", "src/server/auth/roles.ts"]) {
      assert.ok(!/login-rate-limit|rate-limit-buckets/.test(source(file)), file);
    }
  });

  it("keeps the public inquiry gate and its counters apart", () => {
    assert.ok(Object.values(LOGIN_POLICIES).every(({ scope }) => scope.startsWith("admin-login:")));
    assert.match(source("src/server/security/rate-limit.ts"), /scope: `inquiry:\$\{policy\.suffix\}`/);
    for (const file of ["src/app/(public)/contact/actions.ts", "src/server/inquiry/submit-inquiry.ts", "src/content/legal.tsx"]) {
      assert.ok(!/login-rate-limit|sign-in-workflow/.test(source(file)), file);
    }
    assert.match(source("src/server/inquiry/submit-inquiry.ts"), /if \(!dependencies\.isIntakeOpen\(\)\)/);
  });
});
