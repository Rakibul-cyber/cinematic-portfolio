import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { deliveryRecovery, missingDeliveryTypes, STALE_PROCESSING_MS } from "@/lib/email/delivery-claims";
import type { EmailConfig } from "@/server/email/config";
import type { EmailSender, OutboundEmail, SendResult } from "@/server/email/client";

/**
 * Runs the real delivery service against an in-memory client placed in the slot
 * `src/server/db/prisma.ts` reuses, with a fake sender and renderer. No database
 * client is created, and nothing can reach Resend. `create` and `updateMany`
 * check and write in one synchronous step, as the database's unique constraint
 * and conditional update do, so concurrent callers really do compete.
 */

const INQUIRY_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN = "INQUIRY_ADMIN_NOTIFICATION" as const;
const CUSTOMER = "INQUIRY_CUSTOMER_ACKNOWLEDGMENT" as const;
const ACTOR = { id: "actor-id", name: "Admin", email: "actor@example.test", role: "EDITOR" as const };
const SENSITIVE = ["visitor.sentinel@example.test", "Sentinel Visitor", "A sentinel project message", "+49 000 sentinel"];
const CONFIG: EmailConfig = {
  configured: true,
  apiKey: "re_fake",
  from: { address: "studio@example.test" },
  replyTo: null,
  adminRecipients: [{ address: "studio@example.test" }],
  appBaseUrl: "https://studio.example.test",
};

type Row = { id: string; inquiryId: string; type: string; status: string; attemptCount: number; lastErrorCode: string | null; updatedAt: Date };

let rows: Row[];
let audits: Array<Record<string, unknown>>;
let inquiry: Record<string, unknown> | null;
let inquiriesCreated: number;
let failNextClaim: Error | null;
let beforeNextClaim: (() => void) | null;
let service: typeof import("@/server/email/service");
let workflow: typeof import("@/server/email/recovery-workflow");
let queries: typeof import("@/server/email/delivery-claim-queries");

function seedRow(type: string, status: string, ageMs = 0, attemptCount = 1) {
  rows.push({ id: `row-${type}`, inquiryId: INQUIRY_ID, type, status, attemptCount, lastErrorCode: null, updatedAt: new Date(Date.now() - ageMs) });
}

function fakeSender(result: "accept" | "reject" = "accept"): EmailSender & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    provider: "fake",
    sent,
    async send(email) {
      sent.push(email);
      return result === "accept" ? { ok: true, providerMessageId: `message-${sent.length}` } : { ok: false, errorCode: "provider_down" };
    },
  };
}

/** Holds at the provider call until released, so a test can decide who finishes first. */
function gatedSender() {
  const sent: OutboundEmail[] = [];
  let markReached = () => {};
  let release: (result: SendResult) => void = () => {};
  const reached = new Promise<void>((resolve) => { markReached = resolve; });
  const result = new Promise<SendResult>((resolve) => { release = resolve; });
  let gated = false;
  const sender: EmailSender = {
    provider: "gated",
    async send(email) {
      sent.push(email);
      if (gated) return { ok: true, providerMessageId: "after-gate" };
      gated = true;
      markReached();
      return result;
    },
  };
  return { ...sender, sent, reached, release: (value: SendResult) => release(value) };
}

const renderer = {
  renderAdminNotification: async () => ({ html: "<p>admin</p>", text: "admin" }),
  renderCustomerAcknowledgment: async () => ({ html: "<p>customer</p>", text: "customer" }),
};
const dependencies = (sender: EmailSender, confirmed = true) => ({ sender, renderer, config: CONFIG, studioName: "Studio", ...(confirmed ? { confirmedDuplicateRisk: true } : {}) });

before(async () => {
  const client = {
    inquiry: {
      findUnique: async () => inquiry && { ...inquiry, emailDeliveries: rows.map((row) => ({ type: row.type })) },
      create: async () => { inquiriesCreated += 1; },
    },
    // The claim statements, recognised by their text and evaluated in one step.
    $queryRaw: async (query: { strings: readonly string[]; values: unknown[] }) => {
      if (failNextClaim) { const error = failNextClaim; failNextClaim = null; throw error; }
      beforeNextClaim?.();
      beforeNextClaim = null;
      const text = query.strings.join("?");
      const eligible = inquiry !== null && !inquiry.anonymizedAt;
      if (text.includes('INSERT INTO "email_delivery"')) {
        const [id, type, claimedAt] = query.values as [string, string, Date];
        if (!eligible || rows.some((row) => row.type === type)) return [];
        const row: Row = { id, inquiryId: INQUIRY_ID, type, status: "PROCESSING", attemptCount: 1, lastErrorCode: null, updatedAt: claimedAt };
        rows.push(row);
        return [{ ...row }];
      }
      const [claimedAt, , type] = query.values as [Date, string, string];
      const row = rows.find((candidate) => candidate.type === type);
      if (!row || !eligible) return [];
      if (text.includes('"attemptCount" + 1')) {
        if (row.status !== "FAILED" && row.status !== "SKIPPED") return [];
        Object.assign(row, { status: "PROCESSING", attemptCount: row.attemptCount + 1, updatedAt: claimedAt });
        return [{ ...row }];
      }
      const staleBefore = query.values[3] as Date;
      if (row.status !== "PROCESSING" || !(row.updatedAt < staleBefore)) return [];
      row.updatedAt = claimedAt;
      return [{ ...row }];
    },
    emailDelivery: {
      findUnique: async ({ where }: { where: { id?: string; inquiryId_type?: { type: string } } }) => {
        const row = rows.find((candidate) => (where.id ? candidate.id === where.id : candidate.type === where.inquiryId_type!.type));
        return row ? { ...row, inquiry: { anonymizedAt: inquiry?.anonymizedAt ?? null } } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string; attemptCount: number; updatedAt: Date }; data: Partial<Row> }) => {
        const row = rows.find((candidate) => candidate.id === where.id && candidate.status === where.status && candidate.attemptCount === where.attemptCount && candidate.updatedAt.getTime() === where.updatedAt.getTime());
        if (!row) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); } },
  };
  (globalThis as unknown as { cinematicPortfolioPrisma: unknown }).cinematicPortfolioPrisma = client;
  service = await import("@/server/email/service");
  workflow = await import("@/server/email/recovery-workflow");
  queries = await import("@/server/email/delivery-claim-queries");
});

beforeEach(() => {
  rows = [];
  audits = [];
  inquiriesCreated = 0;
  failNextClaim = null;
  beforeNextClaim = null;
  inquiry = {
    id: INQUIRY_ID, createdAt: new Date("2026-11-01T10:00:00.000Z"), anonymizedAt: null,
    nameSnapshot: SENSITIVE[1], emailSnapshot: SENSITIVE[0], phoneSnapshot: SENSITIVE[3], whatsappSnapshot: null, companySnapshot: null,
    serviceNameSnapshot: null, projectType: "Photography", projectDate: null, location: null, budgetLabel: null, referralSource: null, message: SENSITIVE[2],
  };
});

describe("which recovery a delivery offers", () => {
  const now = new Date("2026-11-01T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("offers a plain retry for FAILED and SKIPPED, and nothing for ACCEPTED", () => {
    assert.equal(deliveryRecovery({ status: "FAILED", updatedAt: now }, now), "retry");
    assert.equal(deliveryRecovery({ status: "SKIPPED", updatedAt: now }, now), "retry");
    assert.equal(deliveryRecovery({ status: "ACCEPTED", updatedAt: ago(STALE_PROCESSING_MS * 100) }, now), "none");
  });

  it("offers nothing for an active PROCESSING row, and a confirmed retry only past the window", () => {
    assert.equal(deliveryRecovery({ status: "PROCESSING", updatedAt: ago(STALE_PROCESSING_MS - 1) }, now), "none");
    assert.equal(deliveryRecovery({ status: "PROCESSING", updatedAt: ago(STALE_PROCESSING_MS) }, now), "none");
    assert.equal(deliveryRecovery({ status: "PROCESSING", updatedAt: ago(STALE_PROCESSING_MS + 1) }, now), "confirm");
  });

  it("names exactly the expected deliveries without a record", () => {
    assert.deepEqual(missingDeliveryTypes([]), [ADMIN, CUSTOMER]);
    assert.deepEqual(missingDeliveryTypes([{ type: ADMIN }]), [CUSTOMER]);
    assert.deepEqual(missingDeliveryTypes([{ type: CUSTOMER }]), [ADMIN]);
    assert.deepEqual(missingDeliveryTypes([{ type: ADMIN }, { type: CUSTOMER }]), []);
  });
});

describe("retrying a recorded delivery", () => {
  const STALE = STALE_PROCESSING_MS + 60_000;

  it("recovers a confirmed stale PROCESSING row with the original attempt's idempotency key", async () => {
    seedRow(ADMIN, "PROCESSING", STALE);
    const sender = fakeSender();
    const outcome = await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender));
    assert.equal(outcome.status, "ACCEPTED");
    assert.equal(sender.sent[0]!.idempotencyKey, `${INQUIRY_ID}:${ADMIN}:1`);
    assert.equal(rows[0]!.attemptCount, 1, "the same logical attempt");
  });

  it("refuses a stale PROCESSING row without the confirmation, and sends nothing", async () => {
    seedRow(ADMIN, "PROCESSING", STALE);
    const sender = fakeSender();
    await assert.rejects(service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender, false)), /confirm the duplicate risk/);
    assert.equal(sender.sent.length, 0);
    assert.equal(rows[0]!.status, "PROCESSING");
  });

  it("refuses an active PROCESSING row even when confirmed", async () => {
    seedRow(ADMIN, "PROCESSING", STALE_PROCESSING_MS - 60_000);
    const sender = fakeSender();
    await assert.rejects(service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)), service.DeliveryNotRetryableError);
    assert.equal(sender.sent.length, 0);
  });

  it("refuses an ACCEPTED row even when confirmed", async () => {
    seedRow(ADMIN, "ACCEPTED", STALE);
    const sender = fakeSender();
    await assert.rejects(service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)), service.DeliveryNotRetryableError);
    assert.equal(sender.sent.length, 0);
  });

  it("gives FAILED and SKIPPED a new attempt and key, with no confirmation needed", async () => {
    for (const status of ["FAILED", "SKIPPED"]) {
      rows = [];
      seedRow(ADMIN, status);
      const sender = fakeSender();
      await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender, false));
      assert.equal(sender.sent[0]!.idempotencyKey, `${INQUIRY_ID}:${ADMIN}:2`, status);
    }
  });

  it("lets only one of two concurrent administrators take a stale row", async () => {
    seedRow(ADMIN, "PROCESSING", STALE);
    const sender = fakeSender();
    const results = await Promise.allSettled([
      service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)),
      service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(sender.sent.length, 1);
  });

  it("refuses an anonymized inquiry", async () => {
    seedRow(ADMIN, "PROCESSING", STALE);
    inquiry!.anonymizedAt = new Date();
    const sender = fakeSender();
    await assert.rejects(service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)), service.DeliveryNotRetryableError);
    assert.equal(sender.sent.length, 0);
  });

  it("audits a stale recovery as such, with the real actor and no personal data", async () => {
    seedRow(ADMIN, "PROCESSING", STALE);
    await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(fakeSender()));
    const retried = audits.find((entry) => entry.action === "email.delivery_retried")!;
    assert.equal(retried.actorUserId, ACTOR.id);
    assert.deepEqual(retried.metadata, { inquiryId: INQUIRY_ID, type: ADMIN, staleProcessing: true });
  });
});

describe("recovering missing delivery records", () => {
  it("sends both emails when both records are missing, to the right recipients, on attempt one", async () => {
    const sender = fakeSender();
    const outcomes = await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender));
    assert.deepEqual(outcomes.map((outcome) => [outcome.type, outcome.status]), [[ADMIN, "ACCEPTED"], [CUSTOMER, "ACCEPTED"]]);
    assert.deepEqual(sender.sent.map((email) => email.to[0]!.address), ["studio@example.test", SENSITIVE[0]]);
    assert.deepEqual(sender.sent.map((email) => email.idempotencyKey), [`${INQUIRY_ID}:${ADMIN}:1`, `${INQUIRY_ID}:${CUSTOMER}:1`]);
  });

  it("creates only a missing admin notification, leaving the acknowledgment alone", async () => {
    seedRow(CUSTOMER, "ACCEPTED");
    const sender = fakeSender();
    const outcomes = await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender));
    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0]!.to[0]!.address, "studio@example.test");
    assert.equal(outcomes.find((outcome) => outcome.type === CUSTOMER)?.alreadyClaimed, true);
    assert.equal(rows.length, 2);
  });

  it("creates only a missing acknowledgment, leaving the notification alone", async () => {
    seedRow(ADMIN, "FAILED");
    const sender = fakeSender();
    await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender));
    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0]!.to[0]!.address, SENSITIVE[0]);
    assert.equal(rows.find((row) => row.type === ADMIN)!.status, "FAILED", "a recorded failure stays for its own retry");
  });

  it("refuses without the confirmation, with no records or provider call", async () => {
    const sender = fakeSender();
    await assert.rejects(service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender, false)), /Confirm the duplicate risk/);
    assert.equal(sender.sent.length, 0);
    assert.equal(rows.length, 0);
    assert.equal(audits.length, 0);
  });

  it("refuses when nothing is missing, an inquiry is anonymized, or it does not exist", async () => {
    const sender = fakeSender();
    seedRow(ADMIN, "ACCEPTED");
    seedRow(CUSTOMER, "ACCEPTED");
    await assert.rejects(service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)), /No email records are missing/);
    rows = [];
    inquiry!.anonymizedAt = new Date();
    await assert.rejects(service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)), service.DeliveryNotRetryableError);
    inquiry = null;
    await assert.rejects(service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)), service.DeliveryNotRetryableError);
    assert.equal(sender.sent.length, 0);
    assert.equal(rows.length, 0);
  });

  it("sends once per email across concurrent recovery attempts", async () => {
    const sender = fakeSender();
    const results = await Promise.all([
      service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)),
      service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)),
    ]);
    assert.equal(sender.sent.length, 2);
    assert.equal(new Set(sender.sent.map((email) => email.idempotencyKey)).size, 2);
    assert.equal(rows.length, 2);
    assert.equal(results.flat().filter((outcome) => !outcome.alreadyClaimed).length, 2, "each email had one winner");
  });

  it("does not send again when recovery is repeated", async () => {
    const sender = fakeSender();
    await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender));
    await assert.rejects(service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)), /No email records are missing/);
    assert.equal(sender.sent.length, 2);
  });

  it("records a provider failure as FAILED, then allows an ordinary retry on a new key", async () => {
    const outcomes = await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(fakeSender("reject")));
    assert.deepEqual(outcomes.map((outcome) => outcome.status), ["FAILED", "FAILED"]);
    assert.equal(rows[0]!.lastErrorCode, "provider_down");
    const sender = fakeSender();
    assert.equal((await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender, false))).status, "ACCEPTED");
    assert.equal(sender.sent[0]!.idempotencyKey, `${INQUIRY_ID}:${ADMIN}:2`);
  });

  it("never creates an inquiry", async () => {
    await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(fakeSender()));
    assert.equal(inquiriesCreated, 0);
  });

  it("audits the request and each attempt under the real actor, with identifiers only", async () => {
    await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(fakeSender()));
    const requested = audits.find((entry) => entry.action === "email.delivery_recovery_requested")!;
    assert.equal(requested.entityId, INQUIRY_ID);
    assert.equal(requested.actorUserId, ACTOR.id);
    assert.deepEqual(requested.metadata, { inquiryId: INQUIRY_ID, types: [ADMIN, CUSTOMER] });
    const accepted = audits.filter((entry) => entry.action === "email.delivery_accepted");
    assert.equal(accepted.length, 2);
    assert.ok(accepted.every((entry) => entry.actorUserId === ACTOR.id));
    const stored = JSON.stringify(audits);
    for (const value of SENSITIVE) assert.ok(!stored.includes(value), `the audit trail carries no ${value}`);
  });

  it("logs no personal data when recovery fails unexpectedly", async () => {
    failNextClaim = new Error(`could not write ${SENSITIVE.join(" ")}`);
    const lines: string[] = [];
    const error = mock.method(console, "error", (...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
    try {
      assert.deepEqual(await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(fakeSender())), []);
    } finally {
      error.mock.restore();
    }
    assert.equal(lines.length, 1);
    for (const value of SENSITIVE) assert.ok(!lines[0]!.includes(value), `the log carries no ${value}`);
  });
});

describe("recovery racing with anonymization", () => {
  it("claims and sends nothing when anonymization completed before recovery was requested", async () => {
    inquiry!.anonymizedAt = new Date();
    const sender = fakeSender();
    await assert.rejects(service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)), service.DeliveryNotRetryableError);
    assert.equal(rows.length, 0);
    assert.equal(sender.sent.length, 0);
  });

  it("creates no record when anonymization commits between the earlier read and the claim", async () => {
    beforeNextClaim = () => { inquiry!.anonymizedAt = new Date(); };
    const sender = fakeSender();
    assert.deepEqual(await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(sender)), []);
    assert.equal(rows.length, 0);
    assert.equal(sender.sent.length, 0);
    assert.equal(inquiriesCreated, 0);
  });

  it("stops before the provider when anonymization commits after the claim, and records why", async () => {
    const renderingRenderer = {
      ...renderer,
      renderAdminNotification: async () => { inquiry!.anonymizedAt = new Date(); return { html: "<p>admin</p>", text: "admin" }; },
    };
    const sender = fakeSender();
    const outcomes = await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, { ...dependencies(sender), renderer: renderingRenderer });
    assert.equal(sender.sent.length, 0);
    assert.deepEqual(outcomes, [{ type: ADMIN, status: "SKIPPED", erased: true }]);
    assert.equal(rows[0]!.status, "SKIPPED");
    assert.equal(rows[0]!.lastErrorCode, "inquiry_anonymized");
  });

  it("refuses a retry claim when anonymization commits first", async () => {
    seedRow(ADMIN, "FAILED");
    beforeNextClaim = () => { inquiry!.anonymizedAt = new Date(); };
    const sender = fakeSender();
    await assert.rejects(service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)), service.DeliveryNotRetryableError);
    assert.equal(sender.sent.length, 0);
    assert.equal(rows[0]!.status, "FAILED");
  });

  it("does not pretend a message already with the provider was recalled", async () => {
    const gate = gatedSender();
    const running = service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(gate));
    await gate.reached;
    inquiry!.anonymizedAt = new Date();
    gate.release({ ok: true, providerMessageId: "already-sent" });
    const [admin] = await running;
    assert.equal(admin!.status, "ACCEPTED", "the record says what happened");
    assert.equal(gate.sent.length, 1);
    assert.equal(rows.length, 1, "the acknowledgment was not claimed once the inquiry was erased");
  });

  it("uses a locking, single-statement claim, because a fake cannot exercise PostgreSQL's locks", () => {
    const type = ADMIN;
    const inquiryId = INQUIRY_ID;
    const claimedAt = new Date();
    const statements = [
      queries.claimNewDelivery({ id: "id", inquiryId, type, claimedAt }),
      queries.claimFinishedDelivery({ inquiryId, type, claimedAt }),
      queries.claimStaleDelivery({ inquiryId, type, claimedAt, staleBefore: claimedAt }),
    ].map((statement) => statement.strings.join("?"));
    for (const text of statements) {
      assert.match(text, /"anonymizedAt" IS NULL\s+FOR SHARE/);
      assert.match(text, /RETURNING "id", "inquiryId", "type", "attemptCount"/);
    }
    assert.match(statements[0]!, /ON CONFLICT \("inquiryId", "type"\) DO NOTHING/);
  });
});

describe("stale delivery ownership", () => {
  const MINUTES = 60_000;
  const START = new Date("2026-11-01T12:00:00.000Z").getTime();

  /** Starts a worker, holds it at the provider, then takes over past the stale window. */
  async function oldWorkerAtProvider() {
    const old = gatedSender();
    const oldRun = service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, dependencies(old));
    await old.reached;
    mock.timers.setTime(START + 6 * MINUTES);
    return { old, oldRun };
  }

  beforeEach(() => { mock.timers.enable({ apis: ["Date"], now: START }); });
  afterEach(() => { mock.timers.reset(); });

  it("cannot be overwritten by an old worker finishing after a takeover that is still running", async () => {
    const { old, oldRun } = await oldWorkerAtProvider();
    const newer = gatedSender();
    const newRun = service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(newer));
    await newer.reached;

    old.release({ ok: false, errorCode: "old_worker_failed" });
    const [oldOutcome] = await oldRun;
    assert.deepEqual(oldOutcome, { type: ADMIN, status: "PROCESSING", superseded: true });
    const row = rows.find((candidate) => candidate.type === ADMIN)!;
    assert.equal(row.status, "PROCESSING", "the newer worker still owns the record");
    assert.equal(row.lastErrorCode, null);

    newer.release({ ok: true, providerMessageId: "new" });
    assert.equal((await newRun).status, "ACCEPTED");
    assert.equal(row.status, "ACCEPTED", "the owner's result is recorded");
  });

  it("keeps the new worker's result when it finishes before the old worker", async () => {
    const { old, oldRun } = await oldWorkerAtProvider();
    const newer = fakeSender();
    assert.equal((await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(newer))).status, "ACCEPTED");
    const row = rows.find((candidate) => candidate.type === ADMIN)!;
    const recorded = { ...row };

    old.release({ ok: false, errorCode: "late_failure" });
    const [oldOutcome] = await oldRun;
    assert.deepEqual(oldOutcome, { type: ADMIN, status: "ACCEPTED", superseded: true });
    assert.deepEqual(row, recorded, "the record did not change");
  });

  it("keeps a provider failure during takeover retryable, and not hidden by the old worker's late result", async () => {
    const { old, oldRun } = await oldWorkerAtProvider();
    const failure = await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(fakeSender("reject")));
    assert.equal(failure.status, "FAILED");

    old.release({ ok: true, providerMessageId: "old" });
    await oldRun;
    const row = rows.find((candidate) => candidate.type === ADMIN)!;
    assert.equal(row.status, "FAILED", "the owner's result stands");
    assert.equal(row.lastErrorCode, "provider_down");

    // The audit trail is what shows this retry could send a second email.
    assert.ok(audits.some((entry) => entry.action === "email.delivery_result_superseded" && (entry.metadata as { result: string }).result === "ACCEPTED"));
    const sender = fakeSender();
    assert.equal((await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender, false))).status, "ACCEPTED");
    assert.equal(sender.sent[0]!.idempotencyKey, `${INQUIRY_ID}:${ADMIN}:2`);
  });

  it("records duplicate-send uncertainty: both workers reached the provider on one idempotency key", async () => {
    const { old, oldRun } = await oldWorkerAtProvider();
    const newer = fakeSender();
    await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(newer));
    old.release({ ok: true, providerMessageId: "old" });
    await oldRun;

    // The old worker goes on to its separate acknowledgment, so only its first email is compared.
    assert.equal(newer.sent.length, 1);
    assert.equal(old.sent[0]!.idempotencyKey, newer.sent[0]!.idempotencyKey, "the provider can collapse them within its window, and only then");
    const superseded = audits.filter((entry) => entry.action === "email.delivery_result_superseded");
    assert.equal(superseded.length, 1);
    assert.equal(superseded[0]!.actorUserId, ACTOR.id);
    assert.deepEqual(superseded[0]!.metadata, { inquiryId: INQUIRY_ID, type: ADMIN, attempt: 1, result: "ACCEPTED" });
  });

  it("stops an old worker before the provider if it was taken over while preparing", async () => {
    const slowRenderer = {
      ...renderer,
      renderAdminNotification: async () => {
        mock.timers.setTime(START + 6 * MINUTES);
        await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(newer));
        return { html: "<p>admin</p>", text: "admin" };
      },
    };
    const newer = fakeSender();
    const old = fakeSender();
    const [outcome] = await service.recoverMissingInquiryEmails(INQUIRY_ID, ACTOR, { ...dependencies(old), renderer: slowRenderer });
    const notification = `${INQUIRY_ID}:${ADMIN}:1`;
    assert.ok(!old.sent.some((email) => email.idempotencyKey === notification), "the old worker did not send the notification");
    assert.equal(newer.sent.length, 1);
    assert.equal(newer.sent[0]!.idempotencyKey, notification);
    assert.deepEqual(outcome, { type: ADMIN, status: "ACCEPTED", superseded: true });
  });

  it("lets only one of two concurrent takeovers proceed, on the original key", async () => {
    const { old, oldRun } = await oldWorkerAtProvider();
    const sender = fakeSender();
    const results = await Promise.allSettled([
      service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)),
      service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(sender)),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0]!.idempotencyKey, `${INQUIRY_ID}:${ADMIN}:1`);
    old.release({ ok: true, providerMessageId: "old" });
    await oldRun;
  });

  it("creates no inquiry and writes no personal data to logs or audit, across a takeover", async () => {
    const lines: string[] = [];
    const push = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    const error = mock.method(console, "error", push);
    const warn = mock.method(console, "warn", push);
    try {
      const { old, oldRun } = await oldWorkerAtProvider();
      await service.retryInquiryEmail(INQUIRY_ID, ADMIN, ACTOR, dependencies(fakeSender("reject")));
      old.release({ ok: false, errorCode: "late" });
      await oldRun;
    } finally {
      error.mock.restore();
      warn.mock.restore();
    }
    const written = lines.join(" ") + JSON.stringify(audits);
    for (const value of SENSITIVE) assert.ok(!written.includes(value), `no ${value}`);
    assert.equal(inquiriesCreated, 0);
  });
});

describe("the administrator's answers after a race", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };
  const requireActor = async () => ACTOR;

  it("says a newer attempt owns the email, or that the inquiry was erased, not that email is unconfigured", async () => {
    const retryForm = form({ inquiryId: INQUIRY_ID, type: ADMIN });
    assert.deepEqual(await workflow.runRetryEmail(retryForm, { requireActor, retry: async () => ({ type: ADMIN, status: "PROCESSING", superseded: true }) }), { inquiryId: INQUIRY_ID, outcome: "info", notice: "A newer attempt now owns this email" });
    assert.deepEqual(await workflow.runRetryEmail(retryForm, { requireActor, retry: async () => ({ type: ADMIN, status: "SKIPPED", erased: true }) }), { inquiryId: INQUIRY_ID, outcome: "info", notice: "The inquiry was anonymized, so nothing more was sent" });
    const recovered = await workflow.runRecoverMissingEmails(form({ inquiryId: INQUIRY_ID, confirmDuplicateRisk: "yes" }), { requireActor, recover: async () => [{ type: ADMIN, status: "SKIPPED", erased: true }] });
    assert.equal(recovered.notice, "The inquiry was anonymized, so nothing more was sent");
  });
});

describe("the administrator's request", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };
  const denied = async (): Promise<never> => { throw new Error("NOT_AUTHORIZED"); };
  const allowed = async () => ACTOR;
  const unexpected = async (): Promise<never> => { throw new Error("the service must not run"); };

  it("checks authorization before validation or any service, on both requests", async () => {
    await assert.rejects(workflow.runRetryEmail(form({ inquiryId: "not-a-uuid" }), { requireActor: denied, retry: unexpected }), /NOT_AUTHORIZED/);
    await assert.rejects(workflow.runRecoverMissingEmails(form({ inquiryId: "not-a-uuid" }), { requireActor: denied, recover: unexpected }), /NOT_AUTHORIZED/);
    assert.equal(rows.length, 0);
    assert.equal(audits.length, 0);
  });

  it("recovers missing emails for an authorized administrator who confirmed", async () => {
    const sender = fakeSender();
    const answer = await workflow.runRecoverMissingEmails(form({ inquiryId: INQUIRY_ID, confirmDuplicateRisk: "yes" }), {
      requireActor: allowed,
      recover: (id, actor, options) => service.recoverMissingInquiryEmails(id, actor, { ...dependencies(sender, false), ...options }),
    });
    assert.deepEqual(answer, { inquiryId: INQUIRY_ID, outcome: "saved", notice: "Missing emails accepted by the provider" });
    assert.equal(sender.sent.length, 2);
  });

  it("does not treat an absent or forged confirmation as confirmed", async () => {
    const sender = fakeSender();
    const recover: typeof service.recoverMissingInquiryEmails = (id, actor, options) => service.recoverMissingInquiryEmails(id, actor, { ...dependencies(sender, false), ...options });
    const answer = await workflow.runRecoverMissingEmails(form({ inquiryId: INQUIRY_ID }), { requireActor: allowed, recover });
    assert.equal(answer.outcome, "error");
    assert.equal(sender.sent.length, 0);
    await assert.rejects(workflow.runRecoverMissingEmails(form({ inquiryId: INQUIRY_ID, confirmDuplicateRisk: "true" }), { requireActor: allowed, recover }));
    assert.equal(sender.sent.length, 0);
  });

  it("carries the confirmation through to a stale retry", async () => {
    seedRow(ADMIN, "PROCESSING", STALE_PROCESSING_MS + 60_000);
    const sender = fakeSender();
    const answer = await workflow.runRetryEmail(form({ inquiryId: INQUIRY_ID, type: ADMIN, confirmDuplicateRisk: "yes" }), {
      requireActor: allowed,
      retry: (id, type, actor, options) => service.retryInquiryEmail(id, type, actor, { ...dependencies(sender, false), ...options }),
    });
    assert.equal(answer.outcome, "saved");
    assert.equal(sender.sent.length, 1);
  });

  it("describes a provider failure without provider detail", async () => {
    const answer = await workflow.runRecoverMissingEmails(form({ inquiryId: INQUIRY_ID, confirmDuplicateRisk: "yes" }), {
      requireActor: allowed,
      recover: (id, actor, options) => service.recoverMissingInquiryEmails(id, actor, { ...dependencies(fakeSender("reject"), false), ...options }),
    });
    assert.deepEqual(answer, { inquiryId: INQUIRY_ID, outcome: "error", notice: "A missing email could not be sent" });
  });

  it("hides an unexpected error's text", async () => {
    const answer = await workflow.runRecoverMissingEmails(form({ inquiryId: INQUIRY_ID, confirmDuplicateRisk: "yes" }), {
      requireActor: allowed,
      recover: async () => { throw new Error(`secret ${SENSITIVE[0]}`); },
    });
    assert.deepEqual(answer, { inquiryId: INQUIRY_ID, outcome: "error", notice: "The missing emails could not be sent." });
  });

  it("says when another request already handled the emails", async () => {
    const answer = await workflow.runRecoverMissingEmails(form({ inquiryId: INQUIRY_ID, confirmDuplicateRisk: "yes" }), {
      requireActor: allowed,
      recover: async () => [{ type: ADMIN, status: "PROCESSING", alreadyClaimed: true }],
    });
    assert.equal(answer.outcome, "info");
  });
});
