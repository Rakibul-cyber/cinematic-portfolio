// Must stay first: refuses a non-approved database before anything can connect.
import "../lib/require-non-production-database";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { prisma } from "@/server/db/prisma";
import { consumeInquiryLimit } from "@/server/security/rate-limit";

/**
 * Security checks against real `next start` servers on the disposable branch.
 * Started only by `scripts/integration/run.ts`, which supplies:
 *
 *   INTEGRATION_BASE_MAIN         fully configured server
 *   INTEGRATION_BASE_NO_SECRET    same build, RATE_LIMIT_HMAC_SECRET removed
 *   INTEGRATION_BASE_DB_DOWN      same build, database unreachable
 *   INTEGRATION_USERS             JSON of the seeded test-only accounts
 *
 * Client addresses are sent in Netlify's x-nf-client-connection-ip header, the
 * only one the application trusts, from documentation ranges (RFC 5737).
 */

type Account = { id: string; email: string; password: string; role: string };
type Users = Record<"super" | "admin" | "editor" | "accountLimit" | "clientLimit" | "concurrent" | "separation" | "noSecret", Account>;

const MAIN = required("INTEGRATION_BASE_MAIN");
const NO_SECRET = required("INTEGRATION_BASE_NO_SECRET");
const DB_DOWN = required("INTEGRATION_BASE_DB_DOWN");
const USERS = JSON.parse(required("INTEGRATION_USERS")) as Users;
const REFUSAL = "Too many requests. Please try again later.";
const CLOSED = "Online inquiries will open soon.";
const ACCOUNT_LIMIT = 6;
const CLIENT_LIMIT = 20;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run this suite through scripts/integration/run.ts.`);
  return value;
}

let ipCounter = 0;
/** A fresh documentation-range address per call, so tests never share a client bucket by accident. */
function freshIp(): string {
  ipCounter += 1;
  assert.ok(ipCounter < 250, "freshIp ran out of distinct addresses");
  return `198.51.100.${ipCounter}`;
}
let blockCounter = 0;
/** A different /24 per test, so addresses from different tests can never coincide. */
function ipBlock(): (n: number) => string {
  blockCounter += 1;
  const third = blockCounter;
  return (n: number) => `203.0.${third}.${(n % 250) + 1}`;
}

async function signIn(base: string, email: string, password: string, ip: string) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: base, "x-nf-client-connection-ip": ip },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.text();
  const cookies = response.headers.getSetCookie();
  const session = cookies.find((value) => value.includes("session_token="))?.split(";")[0] ?? null;
  return { status: response.status, body, session, retryAfter: response.headers.get("retry-after") };
}

async function get(base: string, path: string, cookie?: string) {
  const response = await fetch(`${base}${path}`, { redirect: "manual", headers: { origin: base, ...(cookie ? { cookie } : {}) } });
  return { status: response.status, location: response.headers.get("location") ?? "", body: await response.text(), type: response.headers.get("content-type") ?? "" };
}

const sessionToken = (cookie: string) => decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).split(".")[0]!;

before(async () => {
  for (const base of [MAIN, NO_SECRET, DB_DOWN]) {
    const response = await fetch(`${base}/admin/login`, { redirect: "manual" });
    assert.ok(response.status < 500, `${base} is not serving`);
  }
});

after(async () => {
  await prisma.$disconnect();
});

describe("credentials and generic errors", () => {
  it("rejects a wrong password and an unknown account identically, with no session", async () => {
    const ip = freshIp();
    const wrong = await signIn(MAIN, USERS.super.email, `${USERS.super.password}-wrong`, ip);
    const unknown = await signIn(MAIN, `nobody-${Date.now()}@integration.invalid`, "an-unknown-account-password", ip);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, wrong.status);
    assert.equal(unknown.body, wrong.body);
    assert.equal(wrong.session, null);
    assert.equal(unknown.session, null);
    assert.ok(!/not found|no user|does not exist/i.test(wrong.body), "the answer must not reveal whether the account exists");
  });

  it("signs in with valid credentials and signs out, revoking the session server-side", async () => {
    const login = await signIn(MAIN, USERS.super.email, USERS.super.password, freshIp());
    assert.equal(login.status, 200);
    assert.ok(login.session);
    assert.equal((await get(MAIN, "/admin", login.session!)).status, 200);

    const out = await fetch(`${MAIN}/api/auth/sign-out`, { method: "POST", headers: { cookie: login.session!, origin: MAIN, "content-type": "application/json" }, body: "{}" });
    assert.equal(out.status, 200);
    const afterOut = await get(MAIN, "/admin", login.session!);
    assert.ok(afterOut.status >= 300 && afterOut.status < 400 && afterOut.location.includes("/admin/login"));
    assert.equal(await prisma.session.count({ where: { token: sessionToken(login.session!) } }), 0);
  });
});

describe("account rate limit", () => {
  it("blocks an account after six attempts from any mix of addresses, even with the right password", async () => {
    const ip = ipBlock();
    for (let attempt = 0; attempt < ACCOUNT_LIMIT; attempt += 1) {
      assert.equal((await signIn(MAIN, USERS.accountLimit.email, "definitely-the-wrong-password", ip(attempt))).status, 401, `attempt ${attempt + 1}`);
    }
    const blocked = await signIn(MAIN, USERS.accountLimit.email, USERS.accountLimit.password, ip(99));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.session, null);
    assert.ok(Number(blocked.retryAfter) > 0 && Number(blocked.retryAfter) <= 15 * 60, "Retry-After within the 15-minute window");
    assert.ok(blocked.body.includes(REFUSAL));

    // Another account from the same addresses is unaffected.
    assert.equal((await signIn(MAIN, USERS.editor.email, USERS.editor.password, ip(98))).status, 200);
  });

  it("audits the block once per window, whatever the number of refused attempts", async () => {
    const ip = ipBlock();
    for (let attempt = 0; attempt < 3; attempt += 1) await signIn(MAIN, USERS.accountLimit.email, "wrong", ip(attempt));
    const audits = await prisma.auditLog.findMany({ where: { action: "admin.sign_in_throttled" } });
    const accountAudits = audits.filter((row) => JSON.stringify(row.metadata).includes("account"));
    assert.equal(accountAudits.length, 1);
    assert.ok(!JSON.stringify(audits).includes(USERS.accountLimit.email), "the audit row holds no email");
  });
});

describe("client rate limit", () => {
  it("blocks one address after twenty attempts across rotating accounts, and only that address", async () => {
    const ip = ipBlock()(1);
    for (let attempt = 0; attempt < CLIENT_LIMIT; attempt += 1) {
      assert.equal((await signIn(MAIN, `rotating-${attempt}-${Date.now()}@integration.invalid`, "wrong-password-value", ip)).status, 401, `attempt ${attempt + 1}`);
    }
    const blocked = await signIn(MAIN, USERS.clientLimit.email, USERS.clientLimit.password, ip);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.session, null);
    // The account itself was tried once, so from elsewhere it still works.
    assert.equal((await signIn(MAIN, USERS.clientLimit.email, USERS.clientLimit.password, freshIp())).status, 200);
  });
});

describe("concurrent attempts", () => {
  it("lets exactly six of fifteen simultaneous attempts on one account through", async () => {
    const ip = ipBlock();
    const results = await Promise.all(Array.from({ length: 15 }, (_, n) => signIn(MAIN, USERS.concurrent.email, "wrong-concurrent-password", ip(n))));
    const statuses = results.map((result) => result.status).sort();
    assert.equal(statuses.filter((status) => status === 401).length, ACCOUNT_LIMIT, JSON.stringify(statuses));
    assert.equal(statuses.filter((status) => status === 429).length, 15 - ACCOUNT_LIMIT, JSON.stringify(statuses));
    assert.ok(results.every((result) => result.session === null));

    const rows = await prisma.rateLimitBucket.findMany({ where: { scope: "admin-login:account" } });
    assert.ok(rows.some((row) => row.count === 15), "one row counted every attempt");
    assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.keyHash)), "keys are hashes");
  });
});

describe("sessions", () => {
  it("persists across requests, expires after eight hours, and stops working once expired", async () => {
    const login = await signIn(MAIN, USERS.admin.email, USERS.admin.password, freshIp());
    assert.equal(login.status, 200);
    const cookie = login.session!;
    assert.equal((await get(MAIN, "/admin", cookie)).status, 200);
    assert.equal((await get(MAIN, "/admin", cookie)).status, 200);

    const token = sessionToken(cookie);
    const row = await prisma.session.findUniqueOrThrow({ where: { token } });
    const lifetimeHours = (row.expiresAt.getTime() - row.createdAt.getTime()) / 3_600_000;
    assert.ok(lifetimeHours > 7.9 && lifetimeHours <= 8.01, `session lifetime ${lifetimeHours}h`);

    // Expire it in the disposable database, as eight hours passing would.
    await prisma.session.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expired = await get(MAIN, "/admin", cookie);
    assert.ok(expired.status >= 300 && expired.status < 400 && expired.location.includes("/admin/login"), `status ${expired.status}`);
    const session = await fetch(`${MAIN}/api/auth/get-session`, { headers: { cookie } }).then((r) => r.json()).catch(() => null);
    assert.ok(!session?.user, "an expired session resolves to nobody");
  });
});

describe("roles", () => {
  it("keeps administrator-only routes from an editor and opens them to an administrator", async () => {
    const editor = await signIn(MAIN, USERS.editor.email, USERS.editor.password, freshIp());
    const admin = await signIn(MAIN, USERS.admin.email, USERS.admin.password, freshIp());
    assert.ok(editor.session && admin.session);

    assert.equal((await get(MAIN, "/admin", editor.session!)).status, 200);
    assert.equal((await get(MAIN, "/admin/inquiries/export", editor.session!)).status, 403);
    assert.equal((await get(MAIN, "/admin/settings", editor.session!)).status, 403);

    const exported = await get(MAIN, "/admin/inquiries/export", admin.session!);
    assert.equal(exported.status, 200);
    assert.match(exported.type, /text\/csv/);
    assert.equal((await get(MAIN, "/admin/settings", admin.session!)).status, 200);
  });
});

describe("refusal when the limiter cannot work", () => {
  it("refuses correct credentials with no RATE_LIMIT_HMAC_SECRET, writing nothing", async () => {
    const bucketsBefore = await prisma.rateLimitBucket.count();
    const sessionsBefore = await prisma.session.count({ where: { userId: USERS.noSecret.id } });
    const result = await signIn(NO_SECRET, USERS.noSecret.email, USERS.noSecret.password, freshIp());
    assert.equal(result.status, 503);
    assert.equal(result.session, null);
    assert.ok(result.body.includes(REFUSAL));
    assert.equal(await prisma.rateLimitBucket.count(), bucketsBefore);
    assert.equal(await prisma.session.count({ where: { userId: USERS.noSecret.id } }), sessionsBefore);
  });

  it("refuses sign-in, and grants nothing, when the database is unreachable", async () => {
    const result = await signIn(DB_DOWN, USERS.super.email, USERS.super.password, freshIp());
    assert.equal(result.status, 503);
    assert.equal(result.session, null);
    assert.ok(result.body.includes(REFUSAL));
    const page = await get(DB_DOWN, "/admin", "better-auth.session_token=forged.value; __Secure-better-auth.session_token=forged.value");
    assert.notEqual(page.status, 200);
  });
});

describe("the public inquiry action", () => {
  async function callSubmitInquiry(ip: string) {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), ".next/server/server-reference-manifest.json"), "utf8")) as {
      node: Record<string, { exportedName?: string; filename?: string }>;
    };
    const actionId = Object.entries(manifest.node).find(([, entry]) => entry.exportedName === "submitInquiry" && /contact[\\/]actions\.ts$/.test(entry.filename ?? ""))?.[0];
    assert.ok(actionId, "submitInquiry is in the server action manifest");

    const form = new FormData();
    const fields: Record<string, string> = {
      submissionToken: crypto.randomUUID(), website: "", name: "Integration Visitor", email: `visitor-${Date.now()}@integration.invalid`,
      phone: "", whatsapp: "", company: "", projectType: "Photography", projectDate: "", location: "", budgetLabel: "",
      serviceSlug: "", referralSource: "", message: "An integration message that must never be stored.", "cf-turnstile-response": "itest-pass",
    };
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    // React's own encoder, exactly as the browser calls a Server Action.
    const { encodeReply } = createRequire(import.meta.url)("next/dist/compiled/react-server-dom-webpack/client.node.js") as {
      encodeReply: (value: unknown) => Promise<FormData | string>;
    };
    const body = await encodeReply([{ success: false }, form]);
    const response = await fetch(`${MAIN}/contact`, {
      method: "POST",
      headers: { "next-action": actionId!, accept: "text/x-component", origin: MAIN, "x-nf-client-connection-ip": ip },
      body,
    });
    return { status: response.status, text: await response.text() };
  }

  it("does not render the inquiry form while intake is closed", async () => {
    const page = await get(MAIN, "/contact");
    assert.equal(page.status, 200);
    assert.ok(!page.body.includes('name="submissionToken"'), "no inquiry form");
    assert.ok(page.body.includes(CLOSED));
  });

  it("answers a direct action call with the closed wording, saving nothing and consulting nothing", async () => {
    const inquiriesBefore = await prisma.inquiry.count();
    const customersBefore = await prisma.customer.count();
    const inquiryBuckets = () => prisma.rateLimitBucket.count({ where: { scope: { startsWith: "inquiry:" } } });
    const bucketsBefore = await inquiryBuckets();

    const result = await callSubmitInquiry(freshIp());
    assert.equal(result.status, 200);
    assert.ok(result.text.includes(CLOSED), "the real action ran and answered with the closed wording");
    assert.equal(await prisma.inquiry.count(), inquiriesBefore);
    assert.equal(await prisma.customer.count(), customersBefore);
    assert.equal(await inquiryBuckets(), bucketsBefore, "the gate stops before the limiter");
    // The orchestrator also confirms from the network log that Turnstile was never consulted.
  });
});

describe("separation of login and inquiry limits", () => {
  it("an exhausted inquiry limit does not block sign-in from the same address", async () => {
    const ip = ipBlock()(7);
    const identity = { submissionToken: crypto.randomUUID(), normalizedEmail: `separation-${Date.now()}@integration.invalid`, trustedClientIp: ip };
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeInquiryLimit(identity)));
    assert.equal(results.filter((result) => result.allowed).length, 5);

    assert.equal((await signIn(MAIN, USERS.separation.email, USERS.separation.password, ip)).status, 200);
  });

  it("an exhausted sign-in limit does not block inquiries from the same address", async () => {
    const ip = ipBlock()(8);
    for (let attempt = 0; attempt <= CLIENT_LIMIT; attempt += 1) {
      await signIn(MAIN, `separation-rotating-${attempt}-${Date.now()}@integration.invalid`, "wrong-password-value", ip);
    }
    assert.equal((await signIn(MAIN, USERS.separation.email, USERS.separation.password, ip)).status, 429);
    const inquiry = await consumeInquiryLimit({ submissionToken: crypto.randomUUID(), normalizedEmail: `separation-b-${Date.now()}@integration.invalid`, trustedClientIp: ip });
    assert.deepEqual(inquiry, { allowed: true, configured: true });
  });

  it("keeps every counter in its own scope, holding only hashes", async () => {
    const rows = await prisma.rateLimitBucket.findMany();
    const scopes = new Set(rows.map((row) => row.scope));
    for (const scope of scopes) assert.match(scope, /^(admin-login:(account|client)|inquiry:(burst|daily))$/);
    assert.ok(scopes.has("admin-login:client") && scopes.has("inquiry:burst"));
    const stored = JSON.stringify(rows);
    for (const account of Object.values(USERS)) assert.ok(!stored.includes(account.email));
    assert.ok(!/203\.0\.|198\.51\.100\./.test(stored), "no address is stored");
  });
});
