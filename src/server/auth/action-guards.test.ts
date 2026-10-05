import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

/**
 * Pins the authorization guard used by every exported admin server action.
 *
 * The action modules import Prisma and the Next.js runtime, so they are read
 * as source and inspected with the TypeScript AST rather than executed. Each
 * exported action must call exactly one session guard, and it must be the one
 * listed below. Adding an export without listing it here fails the suite, so a
 * new action cannot ship with an unreviewed permission level.
 */

type Guard = "requireUser" | "requireAdmin" | "requireSuperAdmin";

const GUARDS: readonly Guard[] = ["requireUser", "requireAdmin", "requireSuperAdmin"];
const GUARD_MODULE = "@/server/auth/session";
const ADMIN_DIR = path.join(process.cwd(), "src", "app", "(admin)", "admin");

const EXPECTED: Record<string, Record<string, Guard>> = {
  "cms-actions.ts": {
    saveCategoryAction: "requireUser",
    saveServiceAction: "requireUser",
    saveTestimonialAction: "requireUser",
    savePageAction: "requireUser",
    saveSettingsAction: "requireAdmin",
    saveSocialAction: "requireAdmin",
    saveProjectAction: "requireUser",
    deleteAction: "requireAdmin",
  },
  "crm-actions.ts": {
    changeInquiryStatusAction: "requireUser",
    addCustomerNoteAction: "requireUser",
    anonymizeCustomerAction: "requireSuperAdmin",
    updateCustomerAction: "requireUser",
    retryInquiryEmailAction: "requireUser",
  },
  "media/actions.ts": {
    deleteMediaAction: "requireUser",
    updateMediaMetadataAction: "requireUser",
  },
};

interface ModuleScan {
  /** Guard names imported from the session module. */
  importedGuards: Set<string>;
  /** Every runtime export, mapped to the guards its body calls. */
  exports: Map<string, string[]>;
  /** Export forms this scan does not understand (re-exports, `export default`, ...). */
  unsupported: string[];
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function guardCalls(body: ts.Node): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (GUARDS as readonly string[]).includes(node.expression.text)
    ) {
      found.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function scan(relativePath: string): ModuleScan {
  const file = path.join(ADMIN_DIR, relativePath);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result: ModuleScan = {
    importedGuards: new Set(),
    exports: new Map(),
    unsupported: [],
  };

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === GUARD_MODULE
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          // An aliased import would hide the guard from the call scan below.
          assert.equal(
            el.propertyName,
            undefined,
            `${relativePath}: guards must not be imported under an alias`,
          );
          result.importedGuards.add(el.name.text);
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const name = statement.name?.text ?? "default";
      result.exports.set(name, statement.body ? guardCalls(statement.body) : []);
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const decl of statement.declarationList.declarations) {
        const name = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText();
        result.exports.set(name, decl.initializer ? guardCalls(decl.initializer) : []);
      }
      continue;
    }

    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      result.unsupported.push(statement.getText());
    }
  }

  return result;
}

describe("admin server action authorization guards", () => {
  for (const [relativePath, expected] of Object.entries(EXPECTED)) {
    describe(relativePath, () => {
      const scanned = scan(relativePath);

      it("uses only export forms the guard scan understands", () => {
        assert.deepEqual(scanned.unsupported, []);
      });

      it("lists every exported action in the expected guard table", () => {
        assert.deepEqual(
          [...scanned.exports.keys()].sort(),
          Object.keys(expected).sort(),
          `${relativePath}: exported actions differ from the expected table; ` +
            "add any new action with its required guard",
        );
      });

      for (const [action, guard] of Object.entries(expected)) {
        it(`${action} is guarded by ${guard}`, () => {
          assert.ok(scanned.importedGuards.has(guard), `${guard} is not imported from ${GUARD_MODULE}`);
          assert.deepEqual(scanned.exports.get(action), [guard]);
        });
      }
    });
  }

  it("requires ADMIN to edit social links", () => {
    assert.deepEqual(scan("cms-actions.ts").exports.get("saveSocialAction"), [
      "requireAdmin",
    ]);
  });
});
