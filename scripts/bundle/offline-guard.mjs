/**
 * Offline guard for the production-bundle verification (`npm run test:bundle`).
 *
 * Preloaded with `node --import` into the Next.js compile-only build, its
 * worker processes, and the bundle test processes, so it runs before any
 * application or framework module. It allows loopback and local IPC only:
 *
 * - `fetch` to any non-loopback host throws.
 * - `WebSocket` (how the Neon driver reaches PostgreSQL) throws for any host.
 * - TCP connections through `net` (which `http`, `https`, `tls`, and undici
 *   use) throw for any non-loopback host. Named-pipe and Unix-socket IPC stay
 *   allowed, because Node's own worker plumbing uses them.
 *
 * Every process that loads the guard, and every refused attempt, is appended to
 * OFFLINE_GUARD_LOG as one JSON line with the host only, never a URL, header,
 * or body. The runner fails the verification if any process attempted the
 * network or if the build ran without the guard. Each bundle-test process also
 * checks this guard in itself (`assertBundleProcessIsolation` in workspace.ts),
 * probing a reserved `.invalid` host that the runner counts as a self-test.
 *
 * Limits: this is a Node-level control, not OS-level network isolation. It
 * cannot see network APIs it does not hook (for example `dgram` UDP, `dns`
 * resolution, or sockets opened by native addons), and it
 * does not cover native or non-Node subprocesses, which neither load nor honor
 * a Node preload. A complete no-network guarantee needs an OS sandbox or
 * firewall boundary around the whole run.
 */
import { appendFileSync } from "node:fs";
import net from "node:net";

const logFile = process.env.OFFLINE_GUARD_LOG;
Object.defineProperty(globalThis, Symbol.for("munir.bundle.offlineGuard"), {
  value: true,
  configurable: false,
  enumerable: false,
  writable: false,
});
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"]);

function record(entry) {
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
  } catch {
    // Logging must never change what the guard refuses.
  }
}

function refuse(kind, host) {
  record({ kind, host });
  return new Error(`Offline guard refused a ${kind} to ${host || "an unknown host"} during production-bundle verification.`);
}

function hostOf(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = async function offlineGuardedFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? "";
    const host = hostOf(url);
    if (!LOOPBACK.has(host)) throw refuse("fetch", host);
    return realFetch(input, init);
  };
}

if (typeof globalThis.WebSocket === "function") {
  globalThis.WebSocket = function OfflineGuardedWebSocket(url) {
    throw refuse("websocket", hostOf(url));
  };
}

/** The TCP host a `Socket#connect` call targets, or null for local IPC (a pipe or socket path). */
function tcpHost(args) {
  const [first] = args;
  if (Array.isArray(first)) return tcpHost(first);
  if (first && typeof first === "object") {
    if (typeof first.path === "string") return null;
    return String(first.host ?? "localhost").toLowerCase();
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) return null; // a pipe or socket path
  return String(typeof args[1] === "string" ? args[1] : "localhost").toLowerCase();
}

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function offlineGuardedConnect(...args) {
  const host = tcpHost(args);
  if (host !== null && !LOOPBACK.has(host)) throw refuse("tcp", host);
  return realConnect.apply(this, args);
};

record({ kind: "guard-installed", argv1: process.argv[1] ? process.argv[1].split(/[\\/]/).slice(-3).join("/") : "" });
