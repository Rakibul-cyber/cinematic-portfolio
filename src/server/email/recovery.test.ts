import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { Prisma } from "@/generated/prisma/client";
import { deliveryRecovery, missingDeliveryTypes, STALE_PROCESSING_MS } from "@/lib/email/delivery-claims";
import type { EmailConfig } from "@/server/email/config";
import type { EmailSender, OutboundEmail } from "@/server/email/client";

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
type Where = { inquiryId?: string; type?: string; inquiry?: unknown; status?: string | { in: string[] }; updatedAt?: { lt: Date } };

let rows: Row[];
let audits: Array<Record<string, unknown>>;
let inquiry: Record<string, unknown> | null;
let inquiriesCreated: number;
let failNextClaim: Error | null;
let service: typeof import("@/server/email/service");
let workflow: typeof import("@/server/email/recovery-workflow");

const matches = (row: Row, where: Where) =>
  (where.inquiryId === undefined || row.inquiryId === where.inquiryId) &&
  (where.type === undefined || row.type === where.type) &&
  (where.inquiry === undefined || !inquiry?.anonymizedAt) &&
  (where.status === undefined || (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status))) &&
  (where.updatedAt === undefined || row.updatedAt < where.updatedAt.lt);

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
    emailDelivery: {
      create: async ({ data }: { data: { inquiryId: string; type: string; status: string; attemptCount: number } }) => {
        if (failNextClaim) { const error = failNextClaim; failNextClaim = null; throw error; }
        if (rows.some((row) => row.inquiryId === data.inquiryId && row.type === data.type)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const row: Row = { id: `row-${data.type}`, lastErrorCode: null, updatedAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { inquiryId_type: { type: string } } }) => rows.find((row) => row.type === where.inquiryId_type.type) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { inquiryId_type: { type: string } } }) => rows.find((row) => row.type === where.inquiryId_type.type)!,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { Object.assign(rows.find((row) => row.id === where.id)!, data, { updatedAt: new Date() }); },
      updateMany: async ({ where, data }: { where: Where; data: { status: string; attemptCount?: { increment: number } } }) => {
        const taken = rows.filter((row) => matches(row, where));
        for (const row of taken) {
          row.status = data.status;
          row.updatedAt = new Date();
          if (data.attemptCount) row.attemptCount += data.attemptCount.increment;
        }
        return { count: taken.length };
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); } },
  };
  (globalThis as unknown as { cinematicPortfolioPrisma: unknown }).cinematicPortfolioPrisma = client;
  service = await import("@/server/email/service");
  workflow = await import("@/server/email/recovery-workflow");
});

beforeEach(() => {
  rows = [];
  audits = [];
  inquiriesCreated = 0;
  failNextClaim = null;
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
