import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

/**
 * Runs the real `deleteMediaAction` and `updateMediaMetadataAction` through the
 * real `requireAdmin` / `requireRole` / `requireUser` / `getCurrentUser` chain,
 * so a direct call that bypasses the page is shown to be refused, not just
 * absent from the markup.
 *
 * Only the edges are replaced: Better Auth's session lookup, the Prisma user
 * read (where the role comes from), the Next.js request and cache APIs, and the
 * media service. Nothing here reaches a database, R2, or the network. A real
 * HTTP Server Action call against a database is covered by the integration
 * harness, which has not run (docs/06_Plan.md P4-03).
 */

type State = {
  session: { user: { id: string; role?: string } } | null;
  user: { id: string; name: string; email: string; role: string } | null;
  calls: unknown[][];
};
type Actions = {
  deleteMediaAction: (state: unknown, form: FormData) => Promise<unknown>;
  updateMediaMetadataAction: (form: FormData) => Promise<void>;
};

const state = globalThis as typeof globalThis & { __mediaAuthz: State };
const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

const STUBS: Record<string, string> = {
  "server-only": "export {};",
  "next/headers": "export async function headers() { return new Headers(); }",
  "next/navigation": `export function redirect(url) { const error = new Error("NEXT_REDIRECT"); error.redirectTo = url; throw error; }`,
  "next/cache": `export function revalidatePath(path) { globalThis.__mediaAuthz.calls.push(["revalidatePath", path]); }`,
  "@/server/auth/config": "export const auth = { api: { getSession: async () => globalThis.__mediaAuthz.session } };",
  "@/server/db/prisma": "export const prisma = { user: { findUnique: async () => globalThis.__mediaAuthz.user } };",
  "@/server/public/revalidate": `export function revalidatePublicContent(kind) { globalThis.__mediaAuthz.calls.push(["revalidatePublicContent", kind]); }`,
  "@/server/media/service": `
    export class MediaInUseError extends Error {}
    export async function deleteMedia(id, actor) { globalThis.__mediaAuthz.calls.push(["deleteMedia", id, actor.role]); }
    export async function updateMediaMetadata(id, input, actor) { globalThis.__mediaAuthz.calls.push(["updateMediaMetadata", id, actor.role]); }`,
};

let outDir: string;
let actions: Actions;

before(async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: ["src/app/(admin)/admin/media/actions.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    tsconfig: "tsconfig.json",
    logLevel: "silent",
    plugins: [
      {
        name: "edges",
        setup(builder) {
          const filter = new RegExp(`^(${Object.keys(STUBS).map((s) => s.replace(/[/.]/g, "\\$&")).join("|")})$`);
          builder.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
        },
      },
    ],
  });
  outDir = mkdtempSync(join(tmpdir(), "media-authz-"));
  const file = join(outDir, "actions.mjs");
  writeFileSync(file, result.outputFiles[0]!.text);
  actions = (await import(pathToFileURL(file).href)) as Actions;
});

after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

beforeEach(() => {
  state.__mediaAuthz = { session: null, user: null, calls: [] };
});

function signedInAs(role: string, sessionRole = role) {
  state.__mediaAuthz.session = { user: { id: "user-1", role: sessionRole } };
  state.__mediaAuthz.user = { id: "user-1", name: "Someone", email: "someone@example.test", role };
}

const deleteForm = (id = MEDIA_ID) => {
  const form = new FormData();
  form.set("id", id);
  return form;
};

const calls = (name: string) => state.__mediaAuthz.calls.filter((call) => call[0] === name);

describe("deleteMediaAction, called directly", () => {
  it("refuses an EDITOR with AuthorizationError and deletes nothing", async () => {
    signedInAs("EDITOR");
    await assert.rejects(() => actions.deleteMediaAction(null, deleteForm()), (error: Error) => error.name === "AuthorizationError");
    assert.deepEqual(calls("deleteMedia"), []);
    assert.deepEqual(calls("revalidatePath"), [], "no cache purge for a refused request");
  });

  it("checks the role before validating input, so a refusal reveals nothing about the ID", async () => {
    signedInAs("EDITOR");
    await assert.rejects(() => actions.deleteMediaAction(null, deleteForm("not-a-uuid")), (error: Error) => error.name === "AuthorizationError");
  });

  it("takes the role from the user row, not the session payload", async () => {
    // A session claiming ADMIN cannot outrank the role stored in the database.
    signedInAs("EDITOR", "ADMIN");
    await assert.rejects(() => actions.deleteMediaAction(null, deleteForm()), (error: Error) => error.name === "AuthorizationError");
    assert.deepEqual(calls("deleteMedia"), []);
  });

  it("sends an anonymous caller to the login page and deletes nothing", async () => {
    await assert.rejects(
      () => actions.deleteMediaAction(null, deleteForm()),
      (error: Error & { redirectTo?: string }) => error.message === "NEXT_REDIRECT" && /^\/admin\/login\?next=%2Fadmin%2Fmedia$/.test(error.redirectTo ?? ""),
    );
    assert.deepEqual(calls("deleteMedia"), []);
  });

  it("refuses a signed-in session whose user row no longer exists", async () => {
    state.__mediaAuthz.session = { user: { id: "deleted-user" } };
    await assert.rejects(() => actions.deleteMediaAction(null, deleteForm()), (error: Error) => error.message === "NEXT_REDIRECT");
    assert.deepEqual(calls("deleteMedia"), []);
  });

  for (const role of ["ADMIN", "SUPER_ADMIN"]) {
    it(`lets ${role} delete, once, and refreshes the library and public pages`, async () => {
      signedInAs(role);
      assert.equal(await actions.deleteMediaAction(null, deleteForm()), null);
      assert.deepEqual(calls("deleteMedia"), [["deleteMedia", MEDIA_ID, role]]);
      assert.deepEqual(calls("revalidatePath"), [["revalidatePath", "/admin/media"]]);
      assert.deepEqual(calls("revalidatePublicContent"), [["revalidatePublicContent", "media"]]);
    });
  }
});

describe("updateMediaMetadataAction, unchanged", () => {
  it("still lets an EDITOR edit alt text and captions", async () => {
    signedInAs("EDITOR");
    const form = new FormData();
    form.set("id", MEDIA_ID);
    form.set("altText", "A quiet harbour at dawn");
    form.set("caption", "");
    await actions.updateMediaMetadataAction(form);
    assert.deepEqual(calls("updateMediaMetadata"), [["updateMediaMetadata", MEDIA_ID, "EDITOR"]]);
  });
});
