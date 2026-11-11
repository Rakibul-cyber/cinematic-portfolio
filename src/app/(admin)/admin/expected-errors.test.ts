import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ADMIN_CONTENT_LINKS, adminLinksFor } from "@/components/admin/admin-links";
import { Prisma } from "@/generated/prisma/client";
import { describeValidationError } from "@/lib/admin/form-state";
import { anonymizeCustomerSchema, customerSchema, noteSchema } from "@/lib/validation/crm";
import { AdminRole, ADMIN_ROLES, isAdministrative, roleAtLeast } from "@/server/auth/roles";
import { CustomerUpdateError, translateCustomerUpdateError } from "@/server/crm/errors";

/**
 * Predictable admin failures are answered beside the form that caused them,
 * and controls a role cannot use are not offered (QA Fix C). The actions and
 * pages import Prisma and the Next.js runtime, so their wiring is asserted from
 * source, as elsewhere in this suite; the messages and the role rules run for
 * real.
 */

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-0000000000ff";
const read = (file: string) => readFileSync(`src/app/(admin)/admin/${file}`, "utf8");
const body = (source: string, name: string) => {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf("\nexport ", start + 1);
  return end > 0 ? source.slice(start, end) : source.slice(start);
};

function prismaError(code: string) {
  // Shaped like the real thing: the raw message names the constraint and the meta carries identifiers.
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the constraint: \`Customer_normalizedEmail_key\` (${OTHER_ID})`, {
    code,
    clientVersion: "test",
    meta: { target: ["normalizedEmail"], modelName: "Customer", id: OTHER_ID },
  });
}
function translated(error: unknown) {
  try {
    translateCustomerUpdateError(error);
  } catch (caught) {
    return caught;
  }
  assert.fail("translateCustomerUpdateError always throws");
}

describe("incorrect anonymization confirmation", () => {
  it("explains the exact, case-sensitive confirmation and names the field", () => {
    for (const confirmation of ["anonymize", "Anonymize", " ANONYMIZE", ""]) {
      const result = anonymizeCustomerSchema.safeParse({ customerId: ID, confirmation });
      assert.equal(result.success, false, confirmation);
      assert.deepEqual(describeValidationError(result.error!), { error: "Type ANONYMIZE exactly, in capital letters, to confirm.", field: "confirmation" });
    }
  });

  it("still accepts only ANONYMIZE", () => {
    assert.deepEqual(anonymizeCustomerSchema.parse({ customerId: ID, confirmation: "ANONYMIZE" }), { customerId: ID, confirmation: "ANONYMIZE" });
  });
});

describe("customer edits", () => {
  it("reports a duplicate email on the email field without the database's details", () => {
    const error = translated(prismaError("P2002"));
    assert.ok(error instanceof CustomerUpdateError);
    assert.equal(error.message, "Another customer already uses this email address.");
    assert.equal(error.field, "email");
    assert.doesNotMatch(error.message, /constraint|normalizedEmail|prisma|P20\d\d|[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("reports a customer anonymized in the meantime as a form-level message", () => {
    const error = translated(prismaError("P2025"));
    assert.ok(error instanceof CustomerUpdateError);
    assert.equal(error.message, "This customer was anonymized or removed. Reload the page.");
    assert.equal(error.field, undefined);
  });

  it("rethrows anything unexpected unchanged", () => {
    const other = prismaError("P1001");
    assert.equal(translated(other), other);
    const plain = new Error("connection reset");
    assert.equal(translated(plain), plain);
  });

  it("explains an invalid email and an empty note on their fields", () => {
    const customer = customerSchema.safeParse({ id: ID, name: "Synthetic", email: "not-an-email", phone: "", whatsapp: "", company: "" });
    assert.deepEqual(describeValidationError(customer.error!), { error: "Enter a valid email address.", field: "email" });
    const note = noteSchema.safeParse({ customerId: ID, body: "   " });
    assert.deepEqual(describeValidationError(note.error!), { error: "This field is required.", field: "body" });
  });
});

describe("expected failures are returned as form state", () => {
  const crm = read("crm-actions.ts");
  const media = read("media/actions.ts");

  for (const [name, guard] of [["updateCustomerAction", "requireUser"], ["addCustomerNoteAction", "requireUser"], ["anonymizeCustomerAction", "requireSuperAdmin"]] as const) {
    it(`${name} checks ${guard} first, then validates without throwing`, () => {
      const fn = body(crm, name);
      assert.match(fn, /\(_state: AdminFormState, form: FormData\): Promise<AdminFormState>/);
      assert.ok(fn.indexOf(guard) < fn.indexOf("safeParse("), "authorization runs before validation");
      assert.match(fn, /if \(!parsed\.success\) return describeValidationError\(parsed\.error\);/);
      assert.doesNotMatch(fn, /Schema\.parse\(/);
    });
  }

  it("updateCustomerAction returns only CustomerUpdateError and rethrows the rest", () => {
    assert.match(body(crm, "updateCustomerAction"), /if \(error instanceof CustomerUpdateError\) return [^;]+;\s*throw error;/);
  });

  it("deleteMediaAction returns the image-in-use reason and rethrows the rest", () => {
    const fn = body(media, "deleteMediaAction");
    assert.match(fn, /\(\s*_state: AdminFormState,\s*formData: FormData,\s*\): Promise<AdminFormState>/);
    assert.match(fn, /if \(error instanceof MediaInUseError\) return \{ error: error\.message \};\s*throw error;/);
  });

  it("the pages submit these forms through AdminForm", () => {
    const customer = read("customers/[id]/page.tsx");
    for (const action of ["updateCustomerAction", "addCustomerNoteAction", "anonymizeCustomerAction"]) {
      assert.match(customer, new RegExp(`<AdminForm action=\\{${action}\\}`));
      assert.doesNotMatch(customer, new RegExp(`<form action=\\{${action}\\}`));
    }
    assert.match(read("media/page.tsx"), /<AdminForm action=\{deleteMediaAction\}/);
  });
});

describe("role-aware admin controls", () => {
  it("mirror requireAdmin exactly", () => {
    for (const role of ADMIN_ROLES) assert.equal(isAdministrative(role), roleAtLeast(role, AdminRole.ADMIN));
  });

  it("hide Settings from an EDITOR and show it to administrators", () => {
    const labels = (role: AdminRole) => adminLinksFor(role).map((link) => link.label);
    assert.ok(!labels(AdminRole.EDITOR).includes("Settings"));
    assert.ok(labels(AdminRole.ADMIN).includes("Settings"));
    assert.ok(labels(AdminRole.SUPER_ADMIN).includes("Settings"));
    // Everything an EDITOR can open is still there.
    // The six everyday sections (MH-15); an EDITOR gets all but Settings.
    assert.deepEqual(labels(AdminRole.EDITOR), ["Dashboard", "Projects", "Media", "Inquiries", "Customers"]);
    assert.deepEqual(labels(AdminRole.ADMIN), ["Dashboard", "Projects", "Media", "Inquiries", "Customers", "Settings"]);
    // Services and Pages stay reachable for every role, in the secondary group.
    assert.deepEqual(ADMIN_CONTENT_LINKS.map((link) => [link.label, link.href, link.adminOnly]), [["Services", "/admin/services", undefined], ["Pages", "/admin/pages", undefined]]);
    assert.match(readFileSync("src/components/admin/admin-shell.tsx", "utf8"), /\{adminLinksFor\(user\.role\)\.map\(/);
  });

  for (const page of ["projects/page.tsx", "services/page.tsx"]) {
    it(`${page.split("/")[0]}: Delete is offered only to administrators`, () => {
      const source = read(page);
      assert.match(source, /const canDelete = isAdministrative\(user\.role\);/);
      assert.match(source, /\{canDelete \? \(\s*<form action=\{deleteAction\}>/);
      assert.equal((source.match(/<form action=\{deleteAction\}>/g) ?? []).length, 1);
    });
  }

  it("media: Delete is offered only to administrators, and the action requires ADMIN", () => {
    const source = read("media/page.tsx");
    assert.match(source, /const canDelete = isAdministrative\(user\.role\);/);
    assert.match(source, /\{canDelete \? \(\s*<AdminForm action=\{deleteMediaAction\}/);
    assert.equal((source.match(/<AdminForm action=\{deleteMediaAction\}/g) ?? []).length, 1, "no ungated delete control");
    const actions = read("media/actions.ts");
    const fn = body(actions, "deleteMediaAction");
    assert.match(fn, /const actor = await requireAdmin\(ADMIN_MEDIA_PATH\);/);
    assert.ok(fn.indexOf("requireAdmin(") < fn.indexOf("deleteMedia("), "authorization runs before deletion");
    // Editing metadata stays open to every role.
    assert.match(body(actions, "updateMediaMetadataAction"), /requireUser\(ADMIN_MEDIA_PATH\)/);
  });

  it("inquiries: Export CSV is offered only to administrators", () => {
    assert.match(read("inquiries/page.tsx"), /\{isAdministrative\(user\.role\)\?<a [^>]*href="\/admin\/inquiries\/export">Export CSV<\/a>:null\}/);
  });

  it("customer privacy operations stay SUPER_ADMIN-only", () => {
    assert.match(read("customers/[id]/page.tsx"), /\{user\.role === "SUPER_ADMIN" \? <section/);
  });
});

describe("direct requests are still denied on the server", () => {
  it("the Settings page and the inquiry export keep requireAdmin, and the export answers 403", () => {
    const settings = read("settings/page.tsx");
    assert.match(settings, /requireAdmin\("\/admin\/settings"\)\.catch/);
    assert.match(settings, /if \(error instanceof AuthorizationError\) forbidden\(\);\s*throw error;/);
    const exportRoute = read("inquiries/export/route.ts");
    assert.match(exportRoute, /actor = await requireAdmin\("\/admin\/inquiries"\);/);
    assert.match(exportRoute, /if \(error instanceof AuthorizationError\) \{\s*return new Response\("Forbidden", \{ status: 403/);
  });

  it("enables the supported 403 interrupt without changing the shared role guards", () => {
    assert.match(readFileSync("next.config.ts", "utf8"), /authInterrupts: true/);
    assert.match(read("forbidden.tsx"), /<AdminForbiddenView \/>/);
    assert.doesNotMatch(readFileSync("src/server/auth/session.ts", "utf8"), /forbidden\(/);
  });

  it("deleteAction keeps requireAdmin and does not turn a denial into a message", () => {
    const fn = body(read("cms-actions.ts"), "deleteAction");
    assert.match(fn, /const actor = await requireAdmin\("\/admin"\);/);
    assert.doesNotMatch(read("cms-actions.ts"), /AuthorizationError/);
    assert.doesNotMatch(read("crm-actions.ts"), /AuthorizationError/);
    assert.doesNotMatch(read("media/actions.ts"), /AuthorizationError/);
  });
});
