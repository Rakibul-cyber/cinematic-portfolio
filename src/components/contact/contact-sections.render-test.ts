import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BrandStatement, ContactHero, DirectContact, InquiryIntro } from "@/components/contact/contact-sections";
import { contactDetails } from "@/content/site";

/**
 * The contact page design: its public details, its markup, and the boundaries
 * it must keep. The inquiry gate itself is covered by the legal draft tests.
 */

// See turnstile-widget.render-test.ts for why `React` must be a global here.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const render = (element: React.ReactElement) => renderToStaticMarkup(element);
const page = readFileSync("src/app/(public)/contact/page.tsx", "utf8");
const css = readFileSync("src/app/(public)/contact/contact.css", "utf8");

describe("direct contact", () => {
  const html = render(React.createElement(DirectContact));

  it("shows the confirmed public details with mailto and tel links", () => {
    assert.match(html, /href="mailto:official\.munirx@gmail\.com"/);
    assert.match(html, /href="tel:\+4915757801897"/);
    assert.match(html, />\+49 157 57801897</);
    assert.match(html, /Ernst-Lemmer-Straße 17/);
    assert.match(html, /35041 Marburg-Wehrda/);
    assert.match(html, />Germany</);
  });

  it("offers no WhatsApp action until its availability is confirmed", () => {
    assert.doesNotMatch(html, /wa\.me|whatsapp/i);
    assert.doesNotMatch(JSON.stringify(contactDetails), /whatsapp|wa\.me/i);
  });
});

describe("hero and statement", () => {
  it("has one h1 with the accent word, and lets saved CMS copy replace the default", () => {
    const hero = render(React.createElement(ContactHero, { eyebrow: "E", lead: "L" }));
    assert.equal(hero.match(/<h1/g)?.length, 1);
    assert.match(hero, /<em>Extraordinary\.<\/em>/);
    assert.match(render(React.createElement(ContactHero, { eyebrow: "E", lead: "L", title: "Saved title" })), /<h1[^>]*>Saved title<\/h1>/);
  });

  it("keeps decorative numerals out of the accessible text", () => {
    assert.match(render(React.createElement(ContactHero, { eyebrow: "E", lead: "L" })), /<span aria-hidden="true" class="mv-numeral">01<\/span>Photography/);
  });
});

describe("no invented or external content", () => {
  const html = [
    render(React.createElement(ContactHero, { eyebrow: "E", lead: "L" })),
    render(React.createElement(InquiryIntro)),
    render(React.createElement(DirectContact)),
    render(React.createElement(BrandStatement)),
  ].join("");

  it("renders no images, frames or scripts, and no external links", () => {
    assert.doesNotMatch(html, /<(img|iframe|script|video)\b/);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);
  });

  it("loads no external stylesheet, font or image from the page styles", () => {
    assert.doesNotMatch(css, /@import|@font-face|url\(/);
  });
});

describe("design boundaries", () => {
  it("scopes every style rule under .mv-contact", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...withoutComments.matchAll(/(?:^|[{}])\s*([^{}@]+)\{/g)].map((match) => match[1]!.trim());
    assert.ok(selectors.length > 20, "rules were found");
    for (const list of selectors) {
      for (const selector of list.split(/,(?![^(]*\))/)) assert.match(selector.trim(), /^\.mv-contact\b/, selector);
    }
  });

  it("overrides site tokens only inside the scope, leaving the global tokens alone", () => {
    assert.doesNotMatch(css, /:root|html\s*\{|body\s*\{/);
    assert.match(readFileSync("src/app/globals.css", "utf8"), /--accent: #a58a69;/);
  });

  it("disables hover movement under reduced motion", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });

  it("keeps the existing site chrome rather than a page-level header or footer", () => {
    assert.doesNotMatch(page, /SiteHeader|SiteFooter/);
  });

  it("keeps the inquiry form behind the gate in the page", () => {
    assert.match(page, /\{isInquiryIntakeOpen\(\) \? \(\s*<InquiryForm /);
    assert.match(page, /<p className="mv-closed">\{emptyStates\.inquiry\}<\/p>/);
  });

  it("still has metadata and structured data", () => {
    assert.match(page, /buildPublicMetadata\(/);
    assert.match(page, /<JsonLd nodes=\{structuredData\} \/>/);
  });
});
