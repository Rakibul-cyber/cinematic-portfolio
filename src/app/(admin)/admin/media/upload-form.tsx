"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MEDIA_ACCEPT, formatBytes } from "@/lib/media";
import {
  UPLOAD_MAX_EDGE,
  UPLOAD_TARGET_BYTES,
  UploadPreparationError,
  prepareImageForUpload,
  type PreparedUpload,
} from "@/lib/media-upload";

type UploadNotice = { message: string; tone: "alert" | "status" };
type UploadStage = "idle" | "preparing" | "uploading";

/** Shown when the server answers without a JSON message, e.g. a platform 413 page. */
export function uploadFailureMessage(status: number): string {
  if (status === 413) return "The image is too large for the server to accept. Export it as a smaller JPEG and try again.";
  return "Upload failed.";
}

export function isLaterMediaOperation(
  target: EventTarget | null,
  uploadForm: HTMLFormElement | null,
): boolean {
  if (!(target instanceof Element)) return false;
  const form = target instanceof HTMLFormElement ? target : target.closest("form");
  return Boolean(
    form && form !== uploadForm && form.closest("[data-media-library]"),
  );
}

type UploadFormProps = {
  /** Replaceable in tests; the browser implementation resizes large photos before upload. */
  prepareFile?: (file: File) => Promise<PreparedUpload>;
};

export function UploadForm({ prepareFile = prepareImageForUpload }: UploadFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState("");
  const [notice, setNotice] = useState<UploadNotice | null>(null);
  const [stage, setStage] = useState<UploadStage>("idle");
  const pending = stage !== "idle";

  useEffect(() => {
    const clearStaleNotice = (event: Event) => {
      if (isLaterMediaOperation(event.target, formRef.current)) setNotice(null);
    };
    // `invalid` is captured because it does not bubble. This also clears the
    // previous upload outcome when browser validation stops a later submit.
    document.addEventListener("submit", clearStaleNotice, true);
    document.addEventListener("invalid", clearStaleNotice, true);
    return () => {
      document.removeEventListener("submit", clearStaleNotice, true);
      document.removeEventListener("invalid", clearStaleNotice, true);
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setNotice(null);
    try {
      const selected = data.get("file");
      if (selected instanceof File && selected.size > 0) {
        setStage("preparing");
        let prepared: PreparedUpload;
        try {
          prepared = await prepareFile(selected);
        } catch (error) {
          setNotice({
            message:
              error instanceof UploadPreparationError
                ? error.message
                : "The image could not be prepared for upload. Export it as a JPEG and try again.",
            tone: "alert",
          });
          return;
        }
        data.set("file", prepared.file, prepared.file.name);
      }
      setStage("uploading");
      const response = await fetch("/api/media", {
        method: "POST",
        body: data,
      });
      // A platform error page (for example a 413 before the route runs) is not JSON.
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setNotice({
          message: result.message ?? uploadFailureMessage(response.status),
          tone: "alert",
        });
        return;
      }
      formRef.current?.reset();
      setFileName("");
      setNotice({
        message: "Image uploaded successfully.",
        tone: "status",
      });
      router.refresh();
    } catch {
      setNotice({
        message:
          "The image could not be uploaded. Check your connection and try again.",
        tone: "alert",
      });
    } finally {
      setStage("idle");
    }
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="grid gap-5 border border-border bg-surface p-6"
    >
      <div>
        <h2 className="font-display text-2xl">Upload image</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          JPEG, PNG, or WebP. Photos larger than {UPLOAD_MAX_EDGE.toLocaleString("en-US")} px
          on the long edge, or over {formatBytes(UPLOAD_TARGET_BYTES)}, are resized in your
          browser before upload. Files are normalized to metadata-free WebP.
        </p>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Image file
        <input
          required
          disabled={pending}
          name="file"
          type="file"
          accept={MEDIA_ACCEPT}
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
          className="min-h-12 border border-border bg-background p-3"
        />
      </label>
      {fileName && (
        <p className="text-sm text-muted-foreground">Selected: {fileName}</p>
      )}
      <label className="grid gap-2 text-sm font-medium">
        Alt text{" "}
        <span className="font-normal text-muted-foreground">
          Optional now; leave empty only when the eventual use is decorative.
        </span>
        <input
          disabled={pending}
          maxLength={500}
          name="altText"
          className="min-h-12 border border-border bg-background px-4"
        />
      </label>
      <button
        disabled={pending}
        className="min-h-12 bg-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
      >
        {stage === "preparing"
          ? "Preparing image…"
          : stage === "uploading"
            ? "Uploading and processing…"
            : "Upload image"}
      </button>
      <p
        role={notice?.tone ?? "status"}
        aria-live={notice?.tone === "alert" ? undefined : "polite"}
        className="min-h-5 text-sm"
      >
        {notice?.message ?? ""}
      </p>
    </form>
  );
}
