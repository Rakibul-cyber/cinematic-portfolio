import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import React, { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as siteCopy from "@/content/site";
import { draftAwareTitle, isValidLegalApproval, legalDraftReasons, legalTodoCount } from "@/lib/legal/draft-status";

/**
 * The draft-legal launch guard: unfinished or unapproved legal text must stay
 * noindex, out of the sitemap, visibly marked as a draft, and must fail
 * `deploy:verify` — and complete, approved text must pass without removing
 * any of those safeguards by hand.
 *
 * Runs without the `react-server` condition, like the other render tests, so
 * the content can also be rendered to markup and cross-checked.
 */

// See turnstile-widget.render-test.ts: under tsx the classic JSX runtime needs
// `React` as a global. The legal content builds its elements at import, so the
// modules that contain it are imported only after this line has run.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

type LegalModule = typeof import("@/content/legal");
type LegalDocumentModule = typeof import("@/components/public/legal-document");
let legal: LegalModule;
let ui: LegalDocumentModule;

before(async () => {
  ui = await import("@/components/public/legal-document");
  legal = await import("@/content/legal");
});

const APPROVED = { approvedOn: "2026-11-02", approvedBy: "Example Law Firm" };
const KEYS = ["impressum", "legalNotice", "datenschutz", "privacy"] as const;
const LEGAL_PATHS = ["/impressum", "/legal-notice", "/datenschutz", "/privacy"];
const navigationPaths = () => siteCopy.legalNavigation.map((item) => item.href);

describe("finding unfinished legal facts", () => {
  it("counts every marker, however deeply nested in fragments, arrays and markup", () => {
    const content = createElement(Fragment, null,
      createElement("p", null, createElement(ui.LegalTodo, null, "name")),
      [createElement("p", { key: "a" }, "Email: ", createElement(ui.LegalTodo, null, "email")), createElement("ul", { key: "b" }, createElement("li", null, createElement(ui.LegalTodo, null, "vat")))],
    );
    assert.equal(legalTodoCount(content, ui.LegalTodo), 3);
  });

  it("also catches a hand-typed [TODO placeholder that bypasses the marker", () => {
    assert.equal(legalTodoCount(createElement("p", null, "Address: [TODO add later]"), ui.LegalTodo), 1);
    assert.equal(legalTodoCount(createElement("p", null, "[ todo: lower case ]"), ui.LegalTodo), 1);
  });

  it("finds nothing in finished text", () => {
    assert.equal(legalTodoCount(createElement("p", null, "Munir Visuals, Example Street 1"), ui.LegalTodo), 0);
  });

  it("renders the marker exactly as the hand-written placeholder did, so no visible text changes", () => {
    assert.equal(renderToStaticMarkup(createElement(ui.LegalTodo, null, "full legal name")), "<strong>[TODO: full legal name]</strong>");
  });
});

describe("approval records", () => {
  it("accepts only a real YYYY-MM-DD date with a named approver", () => {
    assert.equal(isValidLegalApproval(APPROVED), true);
    for (const bad of [null, undefined, { approvedOn: "", approvedBy: "X" }, { approvedOn: "2026-02-30", approvedBy: "X" }, { approvedOn: "02.11.2026", approvedBy: "X" }, { approvedOn: "2026-11-02", approvedBy: "  " }]) {
      assert.equal(isValidLegalApproval(bad as never), false, JSON.stringify(bad));
    }
  });
});

describe("draft decision", () => {
  // Built inside each test: the marker component is only loaded in `before`.
  const finished = () => [createElement("p", null, "Complete text.")];
  const unfinished = () => [createElement("p", null, createElement(ui.LegalTodo, null, "address"))];

  it("is a draft without approval, even with every TODO filled in", () => {
    assert.deepEqual(legalDraftReasons({ content: finished(), approval: null, todoMarker: ui.LegalTodo }), ["no valid approval record (approvedOn YYYY-MM-DD and approvedBy)"]);
  });

  it("is a draft with approval while any TODO remains: approval cannot hide one", () => {
    assert.deepEqual(legalDraftReasons({ content: unfinished(), approval: APPROVED, todoMarker: ui.LegalTodo }), ["1 unfinished TODO item"]);
  });

  it("is publishable only when complete and approved", () => {
    assert.deepEqual(legalDraftReasons({ content: finished(), approval: APPROVED, todoMarker: ui.LegalTodo }), []);
  });
});

describe("the current legal documents", () => {
  it("are all drafts today, each with TODOs and no approval", () => {
    for (const key of KEYS) {
      assert.equal(legal.isLegalDraft(key), true, key);
      assert.equal(legal.legalDocuments[key].approval, null, `${key} carries no invented approval`);
      assert.match(legal.legalDocumentDraftReasons(key).join(" "), /unfinished TODO items.*no valid approval record/, key);
    }
    assert.deepEqual(legal.draftLegalPaths().sort(), [...LEGAL_PATHS].sort());
  });

  it("are counted completely: the structural count equals every [TODO: rendered on the page", () => {
    let total = 0;
    for (const key of KEYS) {
      const sections = legal.legalDocuments[key].sections;
      const structural = sections.reduce((sum, section) => sum + legalTodoCount(section.content, ui.LegalTodo), 0);
      const rendered = (renderToStaticMarkup(createElement(Fragment, null, ...sections.map((s, i) => createElement("div", { key: i }, s.content)))).match(/\[TODO:/g) ?? []).length;
      assert.equal(structural, rendered, key);
      assert.ok(structural > 0, `${key} has TODOs today`);
      total += structural;
    }
    assert.equal(total, 46, "all 46 TODOs found across the four documents");
  });

  it("produce one actionable deploy:verify line per document, naming what to edit", () => {
    const problems = legal.legalLaunchProblems();
    assert.equal(problems.length, 4);
    for (const path of LEGAL_PATHS) assert.ok(problems.some((p) => p.startsWith(`${path} — `) && p.includes("src/content/legal.tsx")), path);
  });
});

describe("draft warning on the page", () => {
  const page = (draft: boolean, language: "de" | "en" = "en") =>
    renderToStaticMarkup(createElement(ui.LegalDocument, { counterpartHref: "/x", counterpartLabel: "X", draft, eyebrow: "E", language, sections: [{ title: "T", content: createElement("p", null, "Body") }], title: "Legal" }));

  it("shows the existing warning while a draft, in both languages", () => {
    assert.match(page(true), /Draft – not approved for publication/);
    assert.match(page(true, "de"), /Entwurf – nicht zur Veröffentlichung freigegeben/);
  });

  it("drops the warning by itself once approved, leaving the text", () => {
    assert.doesNotMatch(page(false), /Draft – not approved/);
    assert.match(page(false), /Body/);
  });
});

describe("wiring", () => {
  const pages = {
    impressum: "src/app/(public)/impressum/page.tsx",
    legalNotice: "src/app/(public)/legal-notice/page.tsx",
    datenschutz: "src/app/(public)/datenschutz/page.tsx",
    privacy: "src/app/(public)/privacy/page.tsx",
  } as const;

  it("makes each legal page noindex and visibly draft from its own status", () => {
    for (const [key, file] of Object.entries(pages)) {
      const source = readFileSync(file, "utf8");
      assert.match(source, new RegExp(`indexable: !isLegalDraft\\("${key}"\\)`), `${file} metadata`);
      assert.match(source, new RegExp(`draft=\\{isLegalDraft\\("${key}"\\)\\}`), `${file} banner`);
    }
  });

  it("passes indexable through to the robots directive", () => {
    assert.match(readFileSync("src/server/public/metadata.ts", "utf8"), /indexable: input\.indexable/);
  });

  it("fails deploy:verify through the shared problem list, after the configuration checks", () => {
    const source = readFileSync("scripts/verify-deploy-flow.ts", "utf8");
    assert.match(source, /legalLaunchProblems\(\)/);
    assert.ok(source.indexOf('section("legal pages")') > source.indexOf('section("security headers coexistence")'));
  });
});

describe("public release safeguards while documents are drafts", () => {
  const pages = {
    impressum: "src/app/(public)/impressum/page.tsx",
    legalNotice: "src/app/(public)/legal-notice/page.tsx",
    datenschutz: "src/app/(public)/datenschutz/page.tsx",
    privacy: "src/app/(public)/privacy/page.tsx",
  } as const;

  it("answers 404 from each legal route, in both its metadata and its page, before anything else", () => {
    for (const [key, file] of Object.entries(pages)) {
      const source = readFileSync(file, "utf8");
      const gate = `if (isLegalDraft("${key}")) notFound();`;
      assert.equal(source.split(gate).length - 1, 2, `${file} gates metadata and page`);
      assert.ok(source.indexOf(gate) < source.indexOf("buildPublicMetadata({"), `${file} metadata gate comes first`);
      assert.ok(source.lastIndexOf(gate) < source.indexOf("<LegalDocument"), `${file} page gate comes first`);
    }
  });

  it("has no loading boundary above the legal routes, which would turn the 404 into a soft 200", () => {
    for (const file of ["src/app/loading.tsx", "src/app/(public)/loading.tsx", ...Object.values(pages).map((page) => page.replace("page.tsx", "loading.tsx"))]) {
      assert.equal(existsSync(file), false, file);
    }
  });

  it("links only published documents from the footer, and omits the legal navigation when none are", () => {
    const source = readFileSync("src/components/layout/site-footer.tsx", "utf8");
    assert.match(source, /legalNavigation\.filter\(\(item\) => !draftPaths\.includes\(item\.href\)\)/);
    assert.match(source, /publishedLegalLinks\.length \?/);
    assert.doesNotMatch(source, /legalNavigation\.map/);
    // Every footer link must be one the gate can recognise as a draft.
    assert.deepEqual(navigationPaths().sort(), [...LEGAL_PATHS].sort());
    for (const path of navigationPaths()) assert.ok(legal.draftLegalPaths().includes(path), `${path} is hidden today`);
  });

  it("keeps inquiry intake closed today", () => {
    assert.equal(legal.isInquiryIntakeOpen(), false);
  });

  it("keeps intake closed while any one of the four legal documents is a draft", () => {
    assert.deepEqual(Object.keys(legal.legalDocuments).sort(), [...KEYS].sort());
    for (const draftKey of KEYS) {
      assert.equal(legal.isInquiryIntakeOpen((key) => key === draftKey), false, `${draftKey} alone keeps intake closed`);
    }
  });

  it("opens intake only when none of the documents is a draft", () => {
    assert.equal(legal.isInquiryIntakeOpen(() => false), true);
  });

  it("binds the server action and the page to the same gate, with no argument that could override it", () => {
    assert.match(readFileSync("src/app/(public)/contact/actions.ts", "utf8"), /isIntakeOpen: \(\) => isInquiryIntakeOpen\(\)/);
    assert.match(readFileSync("src/app/(public)/contact/page.tsx", "utf8"), /\{isInquiryIntakeOpen\(\) \? \(/);
  });

  it("renders the form and Turnstile only while intake is open, and the approved wording otherwise", () => {
    const source = readFileSync("src/app/(public)/contact/page.tsx", "utf8");
    const open = source.indexOf("{isInquiryIntakeOpen() ? (");
    const form = source.indexOf("<InquiryForm ");
    const closed = source.indexOf("{emptyStates.inquiry}");
    assert.ok(open > 0 && open < form && form < closed, "the form sits inside the open branch");
    assert.equal(source.split("<InquiryForm ").length - 1, 1, "the form is rendered from one place");
    assert.equal(siteCopy.emptyStates.inquiry, "Online inquiries will open soon.");
  });
});

describe("metadata titles follow the draft status", () => {
  // The exact titles the pages declared before this change, en dash included.
  const TITLES = {
    impressum: { draft: "Impressum – Entwurf", approved: "Impressum", file: "src/app/(public)/impressum/page.tsx" },
    legalNotice: { draft: "Legal notice – draft", approved: "Legal notice", file: "src/app/(public)/legal-notice/page.tsx" },
    datenschutz: { draft: "Datenschutz – Entwurf", approved: "Datenschutz", file: "src/app/(public)/datenschutz/page.tsx" },
    privacy: { draft: "Privacy notice – draft", approved: "Privacy notice", file: "src/app/(public)/privacy/page.tsx" },
  } as const;

  it("marks a title as a draft in the page's language, and leaves it plain once approved", () => {
    assert.equal(draftAwareTitle("Impressum", "de", true), "Impressum – Entwurf");
    assert.equal(draftAwareTitle("Legal notice", "en", true), "Legal notice – draft");
    assert.equal(draftAwareTitle("Impressum", "de", false), "Impressum");
    assert.equal(draftAwareTitle("Legal notice", "en", false), "Legal notice");
  });

  it("keeps every page's current draft title exactly while it is a draft", () => {
    for (const key of KEYS) {
      assert.equal(legal.legalMetadataTitle(key), TITLES[key].draft, key);
    }
  });

  it("drops only the draft suffix once approved, leaving the underlying title unchanged", () => {
    for (const key of KEYS) {
      const approved = legal.legalMetadataTitle(key, false);
      assert.equal(approved, TITLES[key].approved, key);
      assert.ok(TITLES[key].draft.startsWith(approved), `${key}: the approved title is the draft title's own base`);
    }
  });

  it("derives the title from the same status as the noindex, sitemap and banner decisions", () => {
    for (const key of KEYS) {
      assert.equal(legal.legalMetadataTitle(key), legal.legalMetadataTitle(key, legal.isLegalDraft(key)), key);
    }
  });

  it("is wired into every legal page, with no hard-coded draft title left behind", () => {
    for (const key of KEYS) {
      const source = readFileSync(TITLES[key].file, "utf8");
      assert.match(source, new RegExp(`title: legalMetadataTitle\\("${key}"\\)`), `${key} uses the derived title`);
      assert.doesNotMatch(source, /title: "[^"]*– (Entwurf|draft)"/, `${key} has no literal draft title`);
    }
  });
});

describe("metadata descriptions follow the draft status", () => {
  const FILES = {
    impressum: "src/app/(public)/impressum/page.tsx",
    legalNotice: "src/app/(public)/legal-notice/page.tsx",
    datenschutz: "src/app/(public)/datenschutz/page.tsx",
    privacy: "src/app/(public)/privacy/page.tsx",
  } as const;

  it("keeps each document's draft description while it is a draft", () => {
    for (const key of KEYS) {
      assert.match(legal.legalMetadataDescription(key), /Entwurf|Draft/, key);
      assert.match(legal.legalMetadataDescription(key), /nicht zur Veröffentlichung freigegeben|not approved for publication/, key);
    }
  });

  it("drops every draft claim once approved", () => {
    for (const key of KEYS) {
      const approved = legal.legalMetadataDescription(key, false);
      assert.match(approved, /Munir Visuals/, key);
      assert.doesNotMatch(approved, /entwurf|draft|freigegeben|approved/i, key);
    }
  });

  it("is wired into every legal page, with no hard-coded description left behind", () => {
    for (const key of KEYS) {
      const source = readFileSync(FILES[key], "utf8");
      assert.match(source, new RegExp(`description: legalMetadataDescription\\("${key}"\\)`), `${key} uses the derived description`);
      assert.doesNotMatch(source, /description: "/, `${key} has no literal description`);
    }
  });
});
