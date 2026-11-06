import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UPLOADS_ENDPOINT,
  VIDEO_CHUNK_SIZE_KB,
  VIDEO_MAX_DECLARED_BYTES,
  cancelEndpoint,
  checkVideoFile,
  isUploadUrlOnOrigin,
  startVideoUpload,
  type ChunkUpload,
  type CreateChunkUpload,
} from "@/lib/video-upload";

/**
 * The browser upload controller (P3-11D) with a fake fetch and a fake
 * UpChunk. Nothing leaves the process; the upload URL is fictional.
 */

const UPLOAD_ORIGIN = "https://uploads.example.test";
const SIGNATURE = "fictional-upload-signature-0042";
const UPLOAD_URL = `${UPLOAD_ORIGIN}/upload/abc?sig=${SIGNATURE}`;
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";

const file = (name = "reel.mp4", size = 5_000_000) => ({ name, size }) as unknown as File;

class FakeChunk implements ChunkUpload {
  listeners = new Map<string, (event: { detail?: unknown }) => void>();
  aborted = false;
  options: Parameters<CreateChunkUpload>[0] | null = null;
  on(event: string, listener: (event: { detail?: unknown }) => void) {
    this.listeners.set(event, listener);
  }
  abort() {
    this.aborted = true;
  }
  emit(event: string, detail?: unknown) {
    this.listeners.get(event)?.({ detail });
  }
}

function harness(options: { create?: Response; cancel?: Response; uploadUrl?: string } = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const chunk = new FakeChunk();
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === UPLOADS_ENDPOINT) {
      if (options.create) return options.create;
      return Response.json({ videoId: VIDEO_ID, uploadUrl: options.uploadUrl ?? UPLOAD_URL, expiresAt: "2027-01-01T00:00:00Z" }, { status: 201 });
    }
    return options.cancel ?? Response.json({ status: "CANCELLED" });
  }) as typeof fetch;
  const createChunkUpload: CreateChunkUpload = (chunkOptions) => {
    chunk.options = chunkOptions;
    return chunk;
  };
  const progress: number[] = [];
  const stages: string[] = [];
  const start = (f = file(), title = "Showreel") =>
    startVideoUpload({
      file: f,
      title,
      uploadOrigin: UPLOAD_ORIGIN,
      createChunkUpload,
      fetchImpl,
      onProgress: (p) => progress.push(p),
      onStage: (s) => stages.push(s),
    });
  return { requests, chunk, progress, stages, start };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("preliminary file checks", () => {
  it("accepts supported videos up to the declared 10 GiB and refuses others before any request", () => {
    assert.equal(checkVideoFile(file("Master.MOV", VIDEO_MAX_DECLARED_BYTES), "Title"), null);
    assert.match(checkVideoFile(file("a.mp4", VIDEO_MAX_DECLARED_BYTES + 1), "Title") ?? "", /larger than the allowed/);
    assert.match(checkVideoFile(file("a.exe"), "Title") ?? "", /not a supported video/);
    assert.match(checkVideoFile(file("a.mp4", 0), "Title") ?? "", /not a supported video/);
    assert.match(checkVideoFile(file(), "   ") ?? "", /Enter a title/);
  });

  it("accepts an upload URL only on the configured https origin", () => {
    assert.equal(isUploadUrlOnOrigin(UPLOAD_URL, UPLOAD_ORIGIN), true);
    assert.equal(isUploadUrlOnOrigin("https://evil.example/upload", UPLOAD_ORIGIN), false);
    assert.equal(isUploadUrlOnOrigin("http://uploads.example.test/upload", "http://uploads.example.test"), false);
    assert.equal(isUploadUrlOnOrigin(42, UPLOAD_ORIGIN), false);
  });

  it("uses a chunk size that is a multiple of 256 KiB", () => {
    assert.equal(VIDEO_CHUNK_SIZE_KB % 256, 0);
  });
});

describe("upload progress", () => {
  it("creates the session, uploads in chunks to the returned URL, and reports progress to completion", async () => {
    const h = harness();
    const handle = h.start();
    await flush();
    assert.equal(h.requests[0]!.url, UPLOADS_ENDPOINT);
    assert.deepEqual(JSON.parse(String(h.requests[0]!.init?.body)), { title: "Showreel", filename: "reel.mp4", fileSizeBytes: 5_000_000 });
    assert.equal(h.requests[0]!.init?.credentials, "same-origin");
    assert.equal(h.chunk.options?.endpoint, UPLOAD_URL);
    assert.equal(h.chunk.options?.chunkSize, VIDEO_CHUNK_SIZE_KB);
    h.chunk.emit("progress", 12.5);
    h.chunk.emit("progress", 150);
    h.chunk.emit("progress", "junk");
    h.chunk.emit("success");
    assert.deepEqual(await handle.result, { ok: true, videoId: VIDEO_ID });
    assert.deepEqual(h.progress, [0, 12.5, 100, 100]);
    assert.deepEqual(h.stages, ["starting", "uploading"]);
  });

  it("shows the server's plain refusal and never starts a transfer", async () => {
    const h = harness({ create: Response.json({ error: "too_many_uploads", message: "Another upload is still in progress." }, { status: 409 }) });
    const outcome = await h.start().result;
    assert.deepEqual(outcome, { ok: false, cancelled: false, message: "Another upload is still in progress." });
    assert.equal(h.chunk.options, null);
  });

  it("uses a fixed message for a non-JSON platform error", async () => {
    const h = harness({ create: new Response("<html>502</html>", { status: 502 }) });
    const outcome = await h.start().result;
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.message, /could not be uploaded/);
  });

  it("refuses an upload URL on an unexpected origin and cancels the session", async () => {
    const h = harness({ uploadUrl: `https://evil.example/upload?sig=${SIGNATURE}` });
    const outcome = await h.start().result;
    assert.equal(outcome.ok, false);
    assert.equal(h.chunk.options, null, "no byte goes to an unexpected host");
    assert.equal(h.requests[1]!.url, cancelEndpoint(VIDEO_ID));
  });

  it("reports a transfer error with a fixed message, never the provider's detail", async () => {
    const h = harness();
    const handle = h.start();
    await flush();
    h.chunk.emit("error", { message: `provider said ${SIGNATURE}` });
    const outcome = await handle.result;
    assert.equal(outcome.ok, false);
    const message = outcome.ok ? "" : outcome.message;
    assert.match(message, /interrupted/);
    assert.equal(message.includes(SIGNATURE), false);
  });

  it("checks the file before contacting the server", async () => {
    const h = harness();
    const outcome = await h.start(file("notes.txt")).result;
    assert.equal(outcome.ok, false);
    assert.equal(h.requests.length, 0);
  });
});

describe("upload cancellation", () => {
  it("aborts the transfer and cancels the provider upload", async () => {
    const h = harness();
    const handle = h.start();
    await flush();
    h.chunk.emit("progress", 40);
    handle.cancel();
    handle.cancel();
    const outcome = await handle.result;
    assert.deepEqual(outcome, { ok: false, cancelled: true, message: "The upload was cancelled." });
    assert.equal(h.chunk.aborted, true);
    assert.equal(h.requests.filter((request) => request.url === cancelEndpoint(VIDEO_ID)).length, 1, "cancelled once");
    assert.equal(h.requests.at(-1)!.init?.method, "POST");
    h.chunk.emit("success");
    assert.deepEqual(await handle.result, outcome, "a late success does not change the outcome");
  });

  it("cancels a session that arrives after the user already pressed Cancel", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => (release = resolve));
    const requests: string[] = [];
    const handle = startVideoUpload({
      file: file(),
      title: "Showreel",
      uploadOrigin: UPLOAD_ORIGIN,
      createChunkUpload: () => assert.fail("no transfer after cancel"),
      fetchImpl: (async (url: string) => {
        requests.push(url);
        return url === UPLOADS_ENDPOINT ? pending : Response.json({ status: "CANCELLED" });
      }) as typeof fetch,
    });
    await flush();
    handle.cancel();
    release(Response.json({ videoId: VIDEO_ID, uploadUrl: UPLOAD_URL }, { status: 201 }));
    const outcome = await handle.result;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? false : outcome.cancelled, true);
    assert.deepEqual(requests, [UPLOADS_ENDPOINT, cancelEndpoint(VIDEO_ID)]);
  });

  it("says so when the cancellation could not be confirmed", async () => {
    const h = harness({ cancel: new Response("", { status: 503 }) });
    const handle = h.start();
    await flush();
    handle.cancel();
    const outcome = await handle.result;
    assert.match(outcome.ok ? "" : outcome.message, /could not be confirmed/);
  });
});
