/**
 * Network guard for every integration-harness process.
 *
 * Preloaded with `node --import` into the Next.js build, each `next start`
 * server, and the test suites, so it runs before any application module:
 *
 * - WebSocket connections (how the Neon driver reaches PostgreSQL) are allowed
 *   only to the hosts in INTEGRATION_ALLOWED_HOSTS, the declared disposable
 *   endpoint. Any other host throws before a socket opens.
 * - fetch is allowed only to localhost and those hosts. Cloudflare's Turnstile
 *   endpoint is answered locally; Resend, Sentry, and everything else throw.
 *
 * Every decision, allowed or blocked (localhost aside), is appended to
 * INTEGRATION_NETWORK_LOG as one JSON line, with
 * hosts only and never a URL query, header, body, or token, so the harness can
 * confirm afterwards that each process loaded the guard and nothing escaped.
 *
 * The answers it gives for Turnstile depend on the submitted token:
 *   "itest-pass"         -> success, action "inquiry", fresh timestamp
 *   "itest-unavailable"  -> HTTP 503
 *   anything else        -> success: false
 */
import { appendFileSync } from "node:fs";

const allowed = new Set(
  (process.env.INTEGRATION_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);
const logFile = process.env.INTEGRATION_NETWORK_LOG;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TURNSTILE_HOST = "challenges.cloudflare.com";
const TURNSTILE_PATH = "/turnstile/v0/siteverify";

function record(entry) {
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Logging must never change what the guard allows.
  }
}

function hostOf(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? "";
}

async function turnstileAnswer(init) {
  let token = "";
  try {
    const body = init?.body;
    const params = body instanceof URLSearchParams ? body : new URLSearchParams(typeof body === "string" ? body : "");
    token = params.get("response") ?? "";
  } catch {
    token = "";
  }
  const outcome = token === "itest-pass" ? "pass" : token === "itest-unavailable" ? "unavailable" : "fail";
  record({ kind: "turnstile", outcome });
  if (outcome === "unavailable") return new Response("unavailable", { status: 503 });
  const body = outcome === "pass"
    ? { success: true, action: "inquiry", challenge_ts: new Date().toISOString(), hostname: "localhost" }
    : { success: false, "error-codes": ["invalid-input-response"] };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = async function integrationGuardedFetch(input, init) {
    const url = urlOf(input);
    const host = hostOf(url);
    let path = "";
    try {
      path = new URL(url).pathname;
    } catch {
      path = "";
    }
    if (host === TURNSTILE_HOST && path === TURNSTILE_PATH) return turnstileAnswer(init);
    if (LOCAL_HOSTS.has(host)) return realFetch(input, init);
    if (allowed.has(host)) {
      record({ kind: "allowed-fetch", host });
      return realFetch(input, init);
    }
    record({ kind: "blocked-fetch", host });
    throw new TypeError(`Integration network guard blocked a request to ${host || "an unparseable URL"}.`);
  };
}

const RealWebSocket = globalThis.WebSocket;
if (typeof RealWebSocket === "function") {
  globalThis.WebSocket = class IntegrationGuardedWebSocket extends RealWebSocket {
    constructor(url, protocols) {
      const host = hostOf(url);
      if (!allowed.has(host)) {
        record({ kind: "blocked-websocket", host });
        throw new Error(`Integration network guard blocked a WebSocket to ${host || "an unparseable URL"}.`);
      }
      record({ kind: "allowed-websocket", host });
      super(url, protocols);
    }
  };
}

record({ kind: "guard-installed", allowed: [...allowed], argv1: process.argv[1] ? process.argv[1].split(/[\\/]/).slice(-3).join("/") : "" });
