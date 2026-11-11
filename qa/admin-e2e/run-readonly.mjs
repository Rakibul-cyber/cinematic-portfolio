/**
 * Read-only signed-in checks for the Munir Visuals admin (production).
 *
 * What it does: signs in once with the credentials typed at the prompt, looks
 * at every admin section on a desktop and a phone-sized screen, and signs out.
 *
 * What it cannot do: every request that would change data is blocked inside
 * the browser before it leaves this computer. The only two exceptions are the
 * sign-in and the sign-out themselves. The export links are never followed,
 * because an export writes an audit entry.
 *
 * What signing in and out leaves behind (unavoidable): one session row, which
 * the sign-out revokes, and two audit entries ("signed in", "signed out").
 *
 * The password and the session cookie stay in this process's memory. Nothing
 * secret is printed or written to disk. Results contain counts and statuses
 * only, never names, emails, or message text.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium, request as playwrightRequest } from "playwright-core";

import { ask, askHidden } from "./lib/prompt.mjs";

const BASE = "https://munirvisuals.com";
const OUT_DIR = fileURLToPath(new URL("./out/", import.meta.url));
const HEADED = process.argv.includes("--headed");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The six everyday links, then the quieter "Website content" group (MH-15).
const SECTIONS = [
  { label: "Dashboard", href: "/admin", title: "Dashboard" },
  { label: "Projects", href: "/admin/projects", title: "Projects" },
  { label: "Media", href: "/admin/media", title: "Media library" },
  { label: "Inquiries", href: "/admin/inquiries", title: "Inquiries" },
  { label: "Customers", href: "/admin/customers", title: "Customers" },
  { label: "Settings", href: "/admin/settings", title: "Settings", adminOnly: true },
  { label: "Services", href: "/admin/services", title: "Services", secondary: true },
  { label: "Pages", href: "/admin/pages", title: "Pages", secondary: true },
];

// Removed from the application in MH-15; both addresses must now give the admin 404.
const REMOVED = ["/admin/categories", "/admin/testimonials"];

/* ------------------------------------------------------------------ results */

const results = [];
let viewportName = "desktop";

class Skip extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const notRun = (message) => new Skip("NOT RUN", message);
const blocked = (message) => new Skip("BLOCKED", message);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(area, name, fn) {
  let status = "PASS";
  let evidence = "";
  try {
    evidence = (await fn()) ?? "";
  } catch (error) {
    status = error instanceof Skip ? error.status : "FAIL";
    evidence = String(error?.message ?? error).split("\n")[0].slice(0, 300);
  }
  results.push({ viewport: viewportName, area, name, status, evidence });
  console.log(`${status.padEnd(7)} [${viewportName}] ${area}: ${name}${evidence ? ` :: ${evidence}` : ""}`);
  return status === "PASS";
}

/* ------------------------------------------------------------------ browser */

/** Blocks anything that could change data, unless `state.allowPost` is set. */
async function guard(context, state) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const sameSite = url.origin === BASE;
    if (sameSite && /\/export\/?$/.test(url.pathname)) {
      // An export writes an audit entry. Answer locally and record the attempt.
      state.exportFetches.push(url.pathname.replace(/[0-9a-f-]{36}/g, "<id>"));
      return route.fulfill({ status: 204, body: "" });
    }
    if (sameSite && !SAFE_METHODS.has(request.method())) {
      if (state.allowPost) return route.continue();
      state.blockedWrites.push(`${request.method()} ${url.pathname.replace(/[0-9a-f-]{36}/g, "<id>")}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
}

function track(page) {
  const log = { console: [], failed: [] };
  page.on("console", (message) => {
    if (message.type() === "error") log.console.push(message.text().slice(0, 160));
  });
  page.on("pageerror", (error) => log.console.push(`pageerror: ${String(error).slice(0, 160)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) log.failed.push(`${response.status()} ${new URL(response.url()).pathname.slice(0, 80)}`);
  });
  return {
    reset() {
      log.console.length = 0;
      log.failed.length = 0;
    },
    /** Throws unless the page is free of console errors, failed requests, and sideways scrolling. */
    async assertClean(what) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(log.console.length === 0, `${what}: console errors: ${log.console.slice(0, 3).join(" | ")}`);
      check(log.failed.length === 0, `${what}: failed requests: ${log.failed.slice(0, 3).join(" | ")}`);
      check(overflow <= 0, `${what}: page scrolls sideways by ${overflow}px`);
      return "no console errors, no failed requests, no sideways scroll";
    },
  };
}

async function go(page, path) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return response;
}

const pathOf = (page) => new URL(page.url()).pathname;
const heading = (page) => page.locator("main h1").first().innerText().then((text) => text.trim());

async function openMenuIfCollapsed(page) {
  const button = page.locator("aside button[aria-controls]");
  if ((await button.count()) && (await button.isVisible()) && (await button.getAttribute("aria-expanded")) === "false") {
    await button.click();
  }
}

async function imagesLoaded(page, selector, max = 40) {
  const images = page.locator(selector);
  const count = Math.min(await images.count(), max);
  let broken = 0;
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded().catch(() => {});
    const ok = await image.evaluate(async (element) => {
      if (!element.complete) {
        await new Promise((resolve) => {
          element.addEventListener("load", resolve, { once: true });
          element.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 8000);
        });
      }
      return element.naturalWidth > 0;
    });
    if (!ok) broken += 1;
  }
  return { count, broken };
}

const mediaIds = (page) => page.locator('input[name="mediaIds"]').evaluateAll((inputs) => inputs.map((input) => input.value));

/* ------------------------------------------------------------------ sign-in */

async function signIn(page, state, email, password) {
  await go(page, "/admin/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  state.allowPost = true;
  await page.locator("form button").first().click();
  const outcome = await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/admin/login"), { timeout: 30000 }).then(() => "in"),
    page.locator('p[role="status"]').filter({ hasText: /\S/ }).waitFor({ timeout: 30000 }).then(() => "refused"),
  ]).catch(() => "timeout");
  state.allowPost = false;
  if (outcome === "in") {
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    return;
  }
  const message = outcome === "refused" ? await page.locator('p[role="status"]').innerText() : "no answer within 30 seconds";
  throw new Error(`Sign-in did not succeed (${message.trim()}). The suite made one attempt and will not retry.`);
}

/* -------------------------------------------------------------- test groups */

async function authenticationTests(page, tracker, context) {
  await test("Authentication", "sign-in lands on the dashboard", async () => {
    check(pathOf(page) === "/admin", `landed on ${pathOf(page)}`);
    check((await heading(page)) === "Dashboard", "dashboard heading missing");
    return "landed on /admin";
  });

  await test("Authentication", "session cookie is protected", async () => {
    const cookie = (await context.cookies(BASE)).find((item) => item.name.includes("session_token"));
    check(cookie, "no session cookie found");
    check(cookie.httpOnly, "cookie is readable by scripts (not HttpOnly)");
    check(cookie.secure, "cookie is not marked Secure");
    check(cookie.sameSite === "Lax" || cookie.sameSite === "Strict", `SameSite is ${cookie.sameSite}`);
    const hours = cookie.expires > 0 ? (cookie.expires * 1000 - Date.now()) / 3_600_000 : null;
    check(hours === null || hours <= 8.1, `cookie lives ${hours?.toFixed(1)} hours, longer than the 8-hour session`);
    return `HttpOnly, Secure, SameSite=${cookie.sameSite}, ${cookie.name.startsWith("__Secure-") ? "__Secure- prefix, " : ""}expires in ${hours === null ? "session" : `${hours.toFixed(1)} h`}`;
  });

  await test("Authentication", "session survives a page refresh", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    check(pathOf(page) === "/admin" && (await heading(page)) === "Dashboard", `after refresh: ${pathOf(page)}`);
    return "still signed in after reload";
  });

  await test("Authentication", "login page sends a signed-in user to the dashboard", async () => {
    await go(page, "/admin/login");
    check(pathOf(page) === "/admin", `ended on ${pathOf(page)}`);
    return "redirected to /admin";
  });

  await test("Authentication", "login page ignores an outside return address", async () => {
    await go(page, `/admin/login?next=${encodeURIComponent("https://example.com/")}`);
    const url = new URL(page.url());
    check(url.origin === BASE, `left the site: ${url.origin}`);
    check(url.pathname === "/admin", `ended on ${url.pathname}`);
    return "stayed on the site, went to /admin";
  });
}

async function navigationTests(page, tracker, role) {
  const admin = role !== "EDITOR";
  const expected = SECTIONS.filter((section) => admin || !section.adminOnly);

  await go(page, "/admin");

  if (viewportName === "mobile") {
    await test("Navigation", "menu button opens and closes the navigation", async () => {
      const button = page.locator("aside button[aria-controls]");
      check(await button.isVisible(), "Menu button is not visible at phone width");
      const nav = page.locator('nav[aria-label="Admin"]');
      check(!(await nav.isVisible()), "navigation is already open before pressing Menu");
      await button.click();
      check((await button.getAttribute("aria-expanded")) === "true" && (await nav.isVisible()), "navigation did not open");
      await button.click();
      check((await button.getAttribute("aria-expanded")) === "false" && !(await nav.isVisible()), "navigation did not close");
      return "opens and closes; aria-expanded follows";
    });
  }

  await test("Navigation", `shows the ${expected.length} links for role ${role}`, async () => {
    await openMenuIfCollapsed(page);
    const hrefs = await page.locator('nav[aria-label="Admin"] a').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const wanted = expected.map((section) => section.href);
    check(JSON.stringify(hrefs) === JSON.stringify(wanted), `links are ${hrefs.join(", ")}`);
    return `${hrefs.length} links in the expected order`;
  });

  await test("Navigation", "Services and Pages sit in a separate Website content group", async () => {
    await openMenuIfCollapsed(page);
    const nav = page.locator('nav[aria-label="Admin"]');
    const order = await nav.evaluate((element) => [...element.children].map((child) => (child.tagName === "A" ? child.getAttribute("href") : child.textContent.trim())));
    const label = order.indexOf("Website content");
    check(label > 0, "the Website content label is missing");
    check(JSON.stringify(order.slice(label + 1)) === JSON.stringify(["/admin/services", "/admin/pages"]), `after the label: ${order.slice(label + 1).join(", ")}`);
    check(!order.some((item) => /categor|testimonial/i.test(item ?? "")), "a removed section is still in the menu");
    return `${label} everyday links, then Website content: Services, Pages`;
  });

  for (const section of expected) {
    await test("Navigation", `${section.label} opens from the menu and renders cleanly`, async () => {
      await openMenuIfCollapsed(page);
      tracker.reset();
      await page.locator(`nav[aria-label="Admin"] a[href="${section.href}"]`).click();
      await page.waitForURL((url) => url.pathname === section.href, { timeout: 20000 });
      // A menu click changes the page without a new document, and Playwright's
      // "networkidle" wait returns at once in that case. So wait for the
      // heading itself, and say how long it took and where the page ended up.
      const started = Date.now();
      let seen = await heading(page);
      while (seen !== section.title && Date.now() - started < 15000) {
        await page.waitForTimeout(100);
        seen = await heading(page).catch(() => "(no heading)");
      }
      const waited = Date.now() - started;
      check(seen === section.title, `after 15 s the heading is "${seen}" at ${pathOf(page)}, expected "${section.title}" at ${section.href}`);
      check(pathOf(page) === section.href, `heading is right but the address moved to ${pathOf(page)}`);
      await openMenuIfCollapsed(page);
      const current = await page.locator(`nav[aria-label="Admin"] a[href="${section.href}"]`).getAttribute("aria-current");
      check(current === "page", `current-page marker is ${current}`);
      if (viewportName === "mobile") await page.locator("aside button[aria-controls]").click();
      const clean = await tracker.assertClean(section.label);
      return waited > 300 ? `${clean}; the heading followed the address after ${waited} ms` : clean;
    });
  }
}

async function dashboardTests(page) {
  let counters = {};
  await test("Dashboard", "shows six numeric counters", async () => {
    await go(page, "/admin");
    const pairs = await page.locator("main dl > div").evaluateAll((items) => items.map((item) => [item.querySelector("dt")?.textContent?.trim(), item.querySelector("dd")?.textContent?.trim()]));
    counters = Object.fromEntries(pairs.map(([label, value]) => [label, Number(value)]));
    const labels = pairs.map(([label]) => label);
    check(JSON.stringify(labels) === JSON.stringify(["Projects", "Published", "Drafts", "Media", "New inquiries", "Open inquiries"]), `counters are ${labels.join(", ")}`);
    check(pairs.every(([, value]) => /^\d+$/.test(value ?? "")), "a counter is not a whole number");
    return pairs.map(([label, value]) => `${label} ${value}`).join(", ");
  });

  await test("Dashboard", "Drafts equals Projects minus Published", async () => {
    check(counters.Drafts === counters.Projects - counters.Published, `${counters.Drafts} vs ${counters.Projects} - ${counters.Published}`);
    return `${counters.Projects} - ${counters.Published} = ${counters.Drafts}`;
  });

  await test("Dashboard", "three quick actions point to real pages", async () => {
    const wanted = ["/admin/projects/new", "/admin/media", "/admin/inquiries"];
    const hrefs = await page.locator("main a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    check(JSON.stringify(hrefs) === JSON.stringify(wanted), `quick actions found: ${hrefs.join(", ")}`);
    return wanted.join(", ");
  });

  const compare = async (label, path, count) =>
    test("Dashboard", `${label} counter matches the ${label.toLowerCase()} list`, async () => {
      await go(page, path);
      const listed = await count();
      check(listed === counters[label], `counter says ${counters[label]}, list shows ${listed}`);
      return `${listed} on both`;
    });
  await compare("Projects", "/admin/projects", () => page.locator('main a[aria-label^="Edit project"]').count());
  await compare("Media", "/admin/media", async () => Number((await page.locator("#library-heading").innerText()).match(/\((\d+)\)/)?.[1]));
}

async function projectTests(page, tracker, role, anonymous) {
  const admin = role !== "EDITOR";
  let editLinks = [];

  await test("Projects", "list page shows projects and a New project link", async () => {
    await go(page, "/admin/projects");
    editLinks = await page.locator('main a[aria-label^="Edit project"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    check(await page.locator('main a[href="/admin/projects/new"]').count(), "New project link missing");
    return `${editLinks.length} projects listed`;
  });

  await test("Projects", admin ? "Delete buttons are offered to an administrator (not pressed)" : "Delete buttons are hidden from an editor", async () => {
    const buttons = await page.locator('main form:has(input[name="kind"][value="project"]) button').count();
    if (admin) check(buttons === editLinks.length, `${buttons} delete buttons for ${editLinks.length} projects`);
    else check(buttons === 0, `${buttons} delete buttons shown to an editor`);
    return `${buttons} delete buttons`;
  });

  await test("Projects", "New project form has every everyday field", async () => {
    tracker.reset();
    await go(page, "/admin/projects/new");
    check((await heading(page)) === "New project", `heading is "${await heading(page)}"`);
    check(await page.locator('input[name="title"][required]').count(), "required title field missing");
    for (const selector of ['textarea[name="summary"]', 'input[name="videoUrl"]', 'input[type="checkbox"][name="status"][value="PUBLISHED"]']) {
      check(await page.locator(selector).count(), `${selector} missing`);
    }
    check(await page.getByRole("button", { name: "Save project" }).count(), "Save project button missing");
    check(!(await page.locator('input[name="categoryId"], select[name="categoryId"]').count()), "a category control is shown");
    return tracker.assertClean("New project");
  });

  await test("Deployment", "media picker fix (commit d0f05a8) is live", async () => {
    const picker = page.locator("fieldset", { has: page.locator("legend", { hasText: "Project media" }) });
    check(await picker.count(), "Project media section missing");
    const upload = await picker.locator("input[data-upload]").count();
    check(upload === 1, "the Project media section has no upload control: production is older than d0f05a8");
    const input = picker.locator("input[data-upload]");
    check((await input.getAttribute("type")) === "file" && (await input.getAttribute("multiple")) !== null, "upload control is not a multi-file input");
    check((await input.getAttribute("name")) === null, "upload control would be submitted with the project form");
    return "upload control present in Project media";
  });

  await test("Projects", "More options (optional) starts closed and opens", async () => {
    const details = page.locator("main details").first();
    const summary = (await details.locator("summary").innerText()).trim();
    check(summary === "More options (optional)", `the section is called "${summary}"`);
    check(!(await details.evaluate((element) => element.open)), "More options is open on arrival");
    await details.locator("summary").click();
    check(await details.evaluate((element) => element.open), "More options did not open");
    for (const name of ["slug", "description", "clientName", "location", "projectDate", "sortOrder", "featured", "seoTitle", "seoDescription"]) {
      check(await details.locator(`[name="${name}"]`).isVisible(), `advanced field ${name} not visible`);
    }
    return "9 advanced fields visible after opening";
  });

  const video = async (label, url, expected) =>
    test("Projects", `video link: ${label}`, async () => {
      const field = page.locator('input[name="videoUrl"]');
      await field.fill(url);
      const status = (await page.locator("#project-video-status").innerText()).trim();
      const invalid = await field.getAttribute("aria-invalid");
      if (expected) {
        check(status === `Detected: ${expected}`, `status is "${status}"`);
        check(invalid === null, "a valid link is marked invalid");
      } else {
        check(invalid === "true" && status.length > 0, `not refused (status "${status}")`);
      }
      return expected ? status : "refused with a message";
    });
  await video("YouTube is recognised", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "YouTube");
  await video("Vimeo is recognised", "https://vimeo.com/76979871", "Vimeo");
  await video("Google Drive is recognised", "https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jK1L2m3N4o5P6q/view", "Google Drive");
  await video("an ordinary web page is refused", "https://example.com/my-film", null);
  await test("Projects", "video link: clearing the link clears the message", async () => {
    await page.locator('input[name="videoUrl"]').fill("");
    check((await page.locator("#project-video-status").innerText()).trim() === "", "message stays after clearing");
    return "empty";
  });

  // The picker is exercised in the browser only. Nothing is saved: the page is
  // left without pressing Save, and a save request would be blocked anyway.
  let libraryIds = [];
  await test("Project media", "library images show loaded thumbnails", async () => {
    libraryIds = await page.locator("[data-add]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-add")));
    if (!libraryIds.length) throw notRun("the media library is empty");
    const { count, broken } = await imagesLoaded(page, "fieldset li img");
    check(count > 0, "no thumbnails are shown for library images");
    check(broken === 0, `${broken} of ${count} thumbnails did not load`);
    return `${count} thumbnails loaded`;
  });

  await test("Project media", "Add attaches an image (not saved)", async () => {
    if (!libraryIds.length) throw notRun("the media library is empty");
    await page.locator(`[data-add="${libraryIds[0]}"]`).click();
    check(JSON.stringify(await mediaIds(page)) === JSON.stringify([libraryIds[0]]), "the image was not added to the form");
    check(await page.locator(`[data-remove="${libraryIds[0]}"]`).isVisible(), "no Remove button for the added image");
    return "1 image attached in the form";
  });

  await test("Project media", "Make cover, Up, Down, and Remove reorder the form (not saved)", async () => {
    if (libraryIds.length < 2) throw notRun("needs at least two images in the media library");
    const [a, b] = libraryIds;
    await page.locator(`[data-add="${b}"]`).click();
    check(JSON.stringify(await mediaIds(page)) === JSON.stringify([a, b]), "second image was not appended");
    check(await page.locator(`[data-cover="${b}"]`).count(), "no Make cover button: production is older than d0f05a8");
    await page.locator(`[data-cover="${b}"]`).click();
    check(JSON.stringify(await mediaIds(page)) === JSON.stringify([b, a]), "Make cover did not move the image first");
    await page.locator(`[data-down="${b}"]`).click();
    check(JSON.stringify(await mediaIds(page)) === JSON.stringify([a, b]), "Down did not move the image");
    await page.locator(`[data-up="${b}"]`).click();
    check(JSON.stringify(await mediaIds(page)) === JSON.stringify([b, a]), "Up did not move the image");
    await page.locator(`[data-remove="${a}"]`).click();
    check(JSON.stringify(await mediaIds(page)) === JSON.stringify([b]), "Remove did not detach the image");
    check(await page.locator(`[data-add="${a}"]`).count(), "the removed image is no longer offered");
    return "order followed every control";
  });

  await test("Project media", "attached images show loaded thumbnails", async () => {
    if (!libraryIds.length) throw notRun("the media library is empty");
    const { count, broken } = await imagesLoaded(page, "fieldset ol img");
    check(count > 0, "attached image has no thumbnail");
    check(broken === 0, `${broken} of ${count} thumbnails did not load`);
    return `${count} thumbnails loaded`;
  });

  const snapshot = () =>
    page.evaluate(() => {
      const value = (name) => document.querySelector(`[name="${name}"]`)?.value ?? null;
      return {
        title: value("title"),
        summary: value("summary"),
        videoUrl: value("videoUrl"),
        slug: value("slug"),
        published: document.querySelector('input[name="status"]')?.checked ?? null,
        media: Array.from(document.querySelectorAll('input[name="mediaIds"]')).map((input) => input.value),
        version: value("expectedUpdatedAt"),
      };
    });

  if (!editLinks.length) {
    await test("Projects", "existing project opens with its saved values", async () => {
      throw notRun("there are no projects");
    });
  }
  for (const [index, href] of editLinks.slice(0, 3).entries()) {
    let saved = null;
    await test("Projects", `existing project ${index + 1} opens with its saved values and keeps them after refresh`, async () => {
      tracker.reset();
      await go(page, href);
      check((await heading(page)) === "Edit project", `heading is "${await heading(page)}"`);
      saved = await snapshot();
      check(saved.title, "title is empty");
      check(saved.slug, "slug is empty");
      check(saved.version, "the stale-save version field is missing");
      await page.reload({ waitUntil: "domcontentloaded" });
      const again = await snapshot();
      check(JSON.stringify(again) === JSON.stringify(saved), "values changed between two loads");
      await tracker.assertClean("Edit project");
      return `${saved.media.length} images, ${saved.videoUrl ? "a" : "no"} video link, ${saved.published ? "published" : "draft"}`;
    });

    await test("Projects", `existing project ${index + 1}: attached images show thumbnails`, async () => {
      if (!saved) throw blocked("the project did not open");
      if (!saved.media.length) throw notRun("this project has no images");
      const { count, broken } = await imagesLoaded(page, "fieldset ol img");
      check(count === saved.media.length, `${count} thumbnails for ${saved.media.length} images: production may be older than d0f05a8`);
      check(broken === 0, `${broken} thumbnails did not load`);
      return `${count} thumbnails loaded`;
    });

    await test("Projects", `existing project ${index + 1}: public page matches its published state`, async () => {
      if (!saved) throw blocked("the project did not open");
      const response = await anonymous.get(`${BASE}/work/${encodeURIComponent(saved.slug)}`, { maxRedirects: 0 });
      const wanted = saved.published ? 200 : 404;
      check(response.status() === wanted, `${saved.published ? "published" : "draft"} project answers ${response.status()} to a visitor, expected ${wanted}`);
      return `${saved.published ? "published" : "draft"}: visitor gets ${response.status()}`;
    });
  }

  await test("Projects", "an unknown project address shows the admin 404", async () => {
    const response = await go(page, "/admin/projects/00000000-0000-4000-8000-000000000000");
    check(response.status() === 404, `HTTP ${response.status()}`);
    check((await page.locator("h1").first().innerText()).trim() === "Page not found", "not the admin 404 page");
    return "404, Page not found";
  });
}

async function mediaTests(page, tracker, role, anonymous) {
  const admin = role !== "EDITOR";
  let total = 0;
  let sources = [];

  await test("Media library", "page shows the upload form and the image count", async () => {
    tracker.reset();
    await go(page, "/admin/media");
    total = Number((await page.locator("#library-heading").innerText()).match(/\((\d+)\)/)?.[1]);
    const input = page.locator('main form input[type="file"][name="file"]');
    check(await input.count(), "file field missing");
    check((await input.getAttribute("accept")) === "image/jpeg,image/png,image/webp", `accepts ${await input.getAttribute("accept")}`);
    check(await page.getByRole("button", { name: "Upload image" }).count(), "Upload image button missing");
    await tracker.assertClean("Media library");
    return `${total} images`;
  });

  await test("Media library", "every thumbnail loads", async () => {
    if (!total) throw notRun("the media library is empty");
    const { count, broken } = await imagesLoaded(page, "[data-media-library] img", 60);
    check(broken === 0, `${broken} of ${count} thumbnails did not load`);
    sources = await page.locator("[data-media-library] img").evaluateAll((images) => images.map((image) => image.currentSrc || image.src));
    return `${count} thumbnails loaded${total > count ? ` (first ${count} of ${total} checked)` : ""}`;
  });

  await test("Media library", "images are delivered from R2 to a visitor", async () => {
    if (!sources.length) throw notRun("the media library is empty");
    const sample = [...new Set(sources)].slice(0, 10);
    for (const url of sample) {
      const response = await anonymous.get(url);
      check(response.status() === 200, `HTTP ${response.status()} for an image`);
      check((response.headers()["content-type"] ?? "").startsWith("image/webp"), `content type ${response.headers()["content-type"]}`);
      check(/immutable/.test(response.headers()["cache-control"] ?? ""), "no long-lived cache header");
    }
    return `${sample.length} images: 200, image/webp, immutable cache, host ${new URL(sample[0]).host}`;
  });

  await test("Media library", "each image has an alt text and caption form (not submitted)", async () => {
    if (!total) throw notRun("the media library is empty");
    const forms = await page.locator('[data-media-library] form:has(input[name="altText"]):has(input[name="caption"])').count();
    check(forms === total, `${forms} forms for ${total} images`);
    return `${forms} forms`;
  });

  await test("Media library", admin ? "Delete is offered to an administrator (not pressed)" : "Delete is hidden from an editor", async () => {
    if (!total) throw notRun("the media library is empty");
    const buttons = await page.getByRole("button", { name: /Delete image and all variants/ }).count();
    if (admin) check(buttons === total, `${buttons} delete buttons for ${total} images`);
    else check(buttons === 0, `${buttons} delete buttons shown to an editor`);
    return `${buttons} delete buttons`;
  });
}

async function listFormTests(page, tracker, { area, path, noun, fields, role }) {
  const admin = role !== "EDITOR";
  let editCount = 0;

  await test(area, "page shows the create form", async () => {
    tracker.reset();
    await go(page, path);
    for (const name of fields) check(await page.locator(`main form [name="${name}"]`).count(), `field ${name} missing`);
    check(await page.getByRole("button", { name: `Create ${noun}` }).count(), `Create ${noun} button missing`);
    editCount = await page.locator(`main a[aria-label^="Edit ${noun}"]`).count();
    try {
      await tracker.assertClean(area);
    } catch (error) {
      // Say whether the problem is there on every load or was a one-off:
      // load the same page three more times and count the loads with errors.
      let again = 0;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        tracker.reset();
        await go(page, path);
        await page.waitForTimeout(1500);
        if (await tracker.assertClean(area).then(() => false, () => true)) again += 1;
      }
      throw new Error(`[seen again on ${again} of 3 further loads of this page] ${error.message}`);
    }
    return `${fields.length} fields, ${editCount} existing records`;
  });

  await test(area, "Edit loads a record into the form and keeps it after refresh (not saved)", async () => {
    if (!editCount) throw notRun(`there are no ${area.toLowerCase()} yet`);
    await page.locator(`main a[aria-label^="Edit ${noun}"]`).first().click();
    await page.waitForURL((url) => url.searchParams.has("edit"), { timeout: 20000 });
    await page.getByRole("button", { name: `Save ${noun}` }).waitFor({ timeout: 15000 });
    const first = fields[0];
    const value = await page.locator(`main form [name="${first}"]`).first().inputValue();
    check(value.length > 0, `the ${first} field is empty in edit mode`);
    await page.reload({ waitUntil: "domcontentloaded" });
    check((await page.locator(`main form [name="${first}"]`).first().inputValue()) === value, "value changed after refresh");
    return "record loaded; same value after refresh";
  });

  await test(area, admin ? "Delete is offered to an administrator (not pressed)" : "Delete is hidden from an editor", async () => {
    if (!editCount) throw notRun(`there are no ${area.toLowerCase()} yet`);
    await go(page, path);
    const buttons = await page.locator('main form:has(input[name="kind"]) button').count();
    if (admin) check(buttons === editCount, `${buttons} delete buttons for ${editCount} records`);
    else check(buttons === 0, `${buttons} delete buttons shown to an editor`);
    return `${buttons} delete buttons`;
  });
}

async function pagesAndSettingsTests(page, tracker, role) {
  const admin = role !== "EDITOR";

  await test("Pages", "each content page has an edit form (not submitted)", async () => {
    tracker.reset();
    await go(page, "/admin/pages");
    const forms = await page.locator('main form:has([name="title"]):has([name="body"])').count();
    check(forms > 0, "no page forms found");
    const buttons = await page.locator("main form button").count();
    check(buttons >= forms, "a page form has no Save button");
    await tracker.assertClean("Pages");
    return `${forms} page forms`;
  });

  if (!admin) {
    await test("Settings", "an editor is refused the Settings page", async () => {
      const response = await go(page, "/admin/settings");
      check(response.status() === 403 || (await page.locator("h1").first().innerText()).trim() === "Access denied", `HTTP ${response.status()}`);
      return "Access denied";
    });
    return;
  }

  await test("Settings", "site settings form is shown (not submitted)", async () => {
    tracker.reset();
    await go(page, "/admin/settings");
    for (const name of ["studioName", "tagline", "contactEmail", "contactPhone", "whatsappNumber", "locationText", "footerCopyright", "defaultSeoTitle", "defaultSeoDescription"]) {
      check(await page.locator(`main form [name="${name}"]`).count(), `field ${name} missing`);
    }
    check(await page.getByRole("button", { name: "Save settings" }).count(), "Save settings button missing");
    await tracker.assertClean("Settings");
    const named = (await page.locator('main form [name="studioName"]').first().inputValue()).trim().length > 0;
    return `studio name is ${named ? "filled in" : "EMPTY (the site shows the placeholder \"Portfolio\")"}`;
  });

  await test("Settings", "social link form is shown (not submitted)", async () => {
    for (const name of ["platform", "label", "url"]) check(await page.locator(`main form [name="${name}"]`).count(), `field ${name} missing`);
    check(await page.getByRole("button", { name: "Add social link" }).count(), "Add social link button missing");
    return "form present";
  });
}

async function crmTests(page, tracker, role) {
  const admin = role !== "EDITOR";
  const nothing = "zzqa-no-such-record";

  let inquiryLinks = [];
  let statuses = [];
  await test("Inquiries", "list page renders", async () => {
    tracker.reset();
    await go(page, "/admin/inquiries");
    inquiryLinks = [...new Set(await page.locator('main a[href^="/admin/inquiries/"]:not([href$="/export"])').evaluateAll((links) => links.map((link) => link.getAttribute("href"))))];
    statuses = await page.locator('main select[name="status"] option').evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
    await tracker.assertClean("Inquiries");
    return `${inquiryLinks.length} inquiries on the first page, ${statuses.length} statuses in the filter`;
  });

  await test("Inquiries", "search with no match shows the empty message", async () => {
    await page.locator('main input[name="q"]').fill(nothing);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.waitForURL((url) => url.searchParams.get("q") === nothing, { timeout: 20000 });
    check(await page.getByText("No inquiries found.").count(), "empty message missing");
    check((await page.locator('main input[name="q"]').inputValue()) === nothing, "search text was not kept");
    return "No inquiries found.";
  });

  await test("Inquiries", "status filter works for every status", async () => {
    check(statuses.length === 8, `${statuses.length} statuses offered`);
    await go(page, "/admin/inquiries");
    await page.locator('main select[name="status"]').selectOption(statuses[0]);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.waitForURL((url) => url.searchParams.get("status") === statuses[0], { timeout: 20000 });
    for (const status of statuses) {
      tracker.reset();
      const response = await go(page, `/admin/inquiries?status=${status}`);
      check(response.status() === 200, `${status}: HTTP ${response.status()}`);
      check((await page.locator('main select[name="status"]').inputValue()) === status, `${status}: filter not kept`);
      await tracker.assertClean(`status ${status}`);
    }
    return `${statuses.length} statuses`;
  });

  await test("Inquiries", "pagination moves to the next page", async () => {
    await go(page, "/admin/inquiries");
    const next = page.locator('nav[aria-label="Pagination"] a[rel="next"]');
    if (!(await next.count())) throw notRun("fewer than 26 inquiries, so there is no second page");
    await next.click();
    await page.waitForURL((url) => url.searchParams.get("page") === "2", { timeout: 20000 });
    check(await page.getByText(/Page 2 of/).count(), "page indicator missing");
    return "page 2 shown";
  });

  await test("Inquiries", admin ? "Export CSV is offered to an administrator (not followed)" : "Export CSV is hidden from an editor", async () => {
    await go(page, "/admin/inquiries");
    const links = await page.locator('main a[href="/admin/inquiries/export"]').count();
    check(admin ? links === 1 : links === 0, `${links} export links`);
    return `${links} export link`;
  });

  await test("Inquiries", "an inquiry opens with its status control (not submitted)", async () => {
    if (!inquiryLinks.length) throw notRun("there are no inquiries");
    tracker.reset();
    await go(page, inquiryLinks[0]);
    check((await heading(page)) === "Inquiry", `heading is "${await heading(page)}"`);
    check(await page.locator('main select[name="status"]').count(), "status control missing");
    check(await page.getByRole("button", { name: "Update status" }).count(), "Update status button missing");
    await tracker.assertClean("Inquiry");
    return "detail page shown";
  });

  let customerLinks = [];
  await test("Customers", "list page renders", async () => {
    tracker.reset();
    await go(page, "/admin/customers");
    customerLinks = [...new Set(await page.locator('main a[href^="/admin/customers/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href"))))];
    await tracker.assertClean("Customers");
    return `${customerLinks.length} customers on the first page`;
  });

  await test("Customers", "search with no match shows the empty message", async () => {
    await page.locator('main input[name="q"]').fill(nothing);
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL((url) => url.searchParams.get("q") === nothing, { timeout: 20000 });
    check(await page.getByText("No customers found.").count(), "empty message missing");
    return "No customers found.";
  });

  await test("Customers", "a customer opens; privacy tools match the role (nothing submitted)", async () => {
    if (!customerLinks.length) throw notRun("there are no customers");
    tracker.reset();
    await go(page, customerLinks[0]);
    check((await heading(page)) === "Customer", `heading is "${await heading(page)}"`);
    const privacy = await page.getByRole("heading", { name: "Privacy operations" }).count();
    check(role === "SUPER_ADMIN" ? privacy === 1 : privacy === 0, `privacy tools ${privacy ? "shown" : "hidden"} for role ${role}`);
    await tracker.assertClean("Customer");
    return `privacy tools ${privacy ? "shown" : "hidden"} for ${role}`;
  });
}

async function errorPageTests(page) {
  for (const path of REMOVED) {
    await test("Error pages", `the removed address ${path} shows the admin 404`, async () => {
      const response = await go(page, path);
      check(response.status() === 404, `HTTP ${response.status()}`);
      check((await page.locator("h1").first().innerText()).trim() === "Page not found", "not the admin 404 page");
      return "404, Page not found";
    });
  }

  await test("Error pages", "an unknown admin address shows the admin 404", async () => {
    const response = await go(page, "/admin/qa-no-such-page");
    check(response.status() === 404, `HTTP ${response.status()}`);
    check((await page.locator("h1").first().innerText()).trim() === "Page not found", "not the admin 404 page");
    return "404, Page not found";
  });
}

async function mobileLayoutTests(page, tracker) {
  for (const [name, path] of [["New project form", "/admin/projects/new"], ["Media library", "/admin/media"], ["Settings or dashboard", "/admin"]]) {
    await test("Mobile layout", `${name} fits a phone screen`, async () => {
      tracker.reset();
      await go(page, path);
      return tracker.assertClean(name);
    });
  }
  await test("Mobile layout", "project media controls are large enough to tap", async () => {
    await go(page, "/admin/projects/new");
    const buttons = page.locator("fieldset [data-add], fieldset input[data-upload]");
    const count = await buttons.count();
    if (!count) throw notRun("no media controls to measure");
    const heights = await buttons.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().height)));
    check(Math.min(...heights) >= 40, `smallest control is ${Math.min(...heights)}px tall`);
    return `${count} controls, smallest ${Math.min(...heights)}px`;
  });
}

async function signOutTests(page, state, browser, savedCookies) {
  await test("Authentication", "Sign out returns to the login page", async () => {
    await go(page, "/admin");
    state.allowPost = true;
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/admin/login", { timeout: 30000 });
    state.allowPost = false;
    return "landed on /admin/login";
  });
  state.allowPost = false;

  await test("Authentication", "admin pages are closed again after sign-out", async () => {
    await go(page, "/admin/projects");
    check(pathOf(page) === "/admin/login", `ended on ${pathOf(page)}`);
    return "redirected to login";
  });

  await test("Authentication", "the old session cookie no longer works anywhere", async () => {
    const context = await browser.newContext();
    try {
      await context.addCookies(savedCookies);
      const other = await context.newPage();
      await go(other, "/admin");
      check(pathOf(other) === "/admin/login", "a copy of the signed-out session still opens the admin");
      return "the server rejected the old session";
    } finally {
      await context.close();
    }
  });
}

/* --------------------------------------------------------------------- main */

function writeResults(meta) {
  mkdirSync(OUT_DIR, { recursive: true });
  const totals = { total: results.length };
  for (const status of ["PASS", "FAIL", "BLOCKED", "NOT RUN"]) totals[status] = results.filter((result) => result.status === status).length;
  writeFileSync(`${OUT_DIR}readonly-results.json`, JSON.stringify({ ...meta, totals, results }, null, 2));
  const rows = results.map((result) => `| ${result.viewport} | ${result.area} | ${result.name} | ${result.status} | ${result.evidence.replace(/\|/g, "/")} |`);
  writeFileSync(
    `${OUT_DIR}readonly-results.md`,
    [`# Read-only signed-in admin results`, "", `Run: ${meta.finishedAt} · role ${meta.role} · ${BASE}`, "",
      `Total ${totals.total}: PASS ${totals.PASS}, FAIL ${totals.FAIL}, BLOCKED ${totals.BLOCKED}, NOT RUN ${totals["NOT RUN"]}`, "",
      "| Screen | Area | Test | Status | Evidence |", "| --- | --- | --- | --- | --- |", ...rows, ""].join("\n"),
  );
  return totals;
}

async function main() {
  console.log("\nMunir Visuals admin: read-only signed-in checks");
  console.log(`Site: ${BASE}`);
  console.log("Nothing is created, changed, or deleted. Signing in and out records two audit entries.\n");

  const email = await ask("Admin email: ");
  let password = await askHidden("Admin password (hidden): ");
  if (!email || !password) {
    console.error("Email and password are both required. Nothing was sent.");
    process.exit(1);
  }

  const state = { allowPost: false, blockedWrites: [], exportFetches: [] };
  const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
  const anonymous = await playwrightRequest.newContext();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  desktop.setDefaultTimeout(15000);
  await guard(desktop, state);
  const page = await desktop.newPage();
  const tracker = track(page);
  let signedIn = false;
  let role = "UNKNOWN";

  try {
    try {
      await signIn(page, state, email, password);
      signedIn = true;
    } finally {
      password = "";
    }

    role = (await page.locator("aside p").nth(1).innerText()).split("·").pop().trim();
    console.log(`Signed in. Role: ${role}\n`);
    const savedCookies = await desktop.cookies(BASE);

    viewportName = "desktop";
    await authenticationTests(page, tracker, desktop);
    await navigationTests(page, tracker, role);
    await dashboardTests(page);
    await projectTests(page, tracker, role, anonymous);
    await mediaTests(page, tracker, role, anonymous);
    await listFormTests(page, tracker, { area: "Services", path: "/admin/services", noun: "service", fields: ["name", "slug", "shortDescription", "description", "priceLabel", "sortOrder", "isActive"], role });
    await pagesAndSettingsTests(page, tracker, role);
    await crmTests(page, tracker, role);
    await errorPageTests(page);

    viewportName = "mobile";
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      storageState: await desktop.storageState(),
    });
    mobile.setDefaultTimeout(15000);
    await guard(mobile, state);
    const phone = await mobile.newPage();
    const phoneTracker = track(phone);
    await navigationTests(phone, phoneTracker, role);
    await mobileLayoutTests(phone, phoneTracker);
    await mobile.close();

    viewportName = "desktop";
    await test("Safety", "no data-changing request was attempted", async () => {
      check(state.blockedWrites.length === 0, `${state.blockedWrites.length} blocked: ${[...new Set(state.blockedWrites)].slice(0, 4).join(", ")}`);
      return "0 blocked requests";
    });
    await test("Audit", "export links are not fetched until someone clicks them", async () => {
      check(state.exportFetches.length === 0, `the browser requested an export ${state.exportFetches.length} times without a click (${[...new Set(state.exportFetches)].join(", ")}); each real request would export data and write an audit entry`);
      return "0 automatic export requests";
    });

    await signOutTests(page, state, browser, savedCookies);
    signedIn = false;
  } catch (error) {
    console.error(`\nStopped: ${String(error?.message ?? error).split("\n")[0]}`);
    results.push({ viewport: viewportName, area: "Run", name: "suite completed", status: "BLOCKED", evidence: String(error?.message ?? error).split("\n")[0].slice(0, 300) });
  } finally {
    if (signedIn) {
      // Never leave a live session behind if the run stopped early.
      try {
        state.allowPost = true;
        await go(page, "/admin");
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.waitForURL((url) => url.pathname === "/admin/login", { timeout: 30000 });
        console.log("Signed out after an early stop.");
      } catch {
        console.error("Could not sign out automatically. Sign in to the admin and press Sign out, or wait 8 hours for the session to expire.");
      }
    }
    await anonymous.dispose();
    await browser.close();
  }

  const totals = writeResults({ finishedAt: new Date().toISOString(), role, site: BASE });
  console.log(`\nTotal ${totals.total}: PASS ${totals.PASS}, FAIL ${totals.FAIL}, BLOCKED ${totals.BLOCKED}, NOT RUN ${totals["NOT RUN"]}`);
  console.log(`Results saved to ${OUT_DIR}readonly-results.md (no passwords, cookies, names, or emails).`);
  process.exitCode = totals.FAIL || totals.BLOCKED ? 1 : 0;
}

try {
  await main();
} catch (error) {
  console.error(`\nCould not run: ${String(error?.message ?? error).split("\n")[0]}`);
  process.exitCode = 1;
}
