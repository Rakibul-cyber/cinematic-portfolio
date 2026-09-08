"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MEDIA_ACCEPT, MEDIA_MAX_BYTES, formatBytes } from "@/lib/media";

export function UploadForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage("");
    try {
      const response = await fetch("/api/media", { method: "POST", body: new FormData(event.currentTarget) });
      const result = await response.json() as { message?: string };
      if (!response.ok) { setMessage(result.message ?? "Upload failed."); return; }
      formRef.current?.reset(); setFileName(""); setMessage("Image uploaded successfully."); router.refresh();
    } catch { setMessage("The image could not be uploaded. Check your connection and try again."); }
    finally { setPending(false); }
  }
  return <form ref={formRef} onSubmit={submit} className="grid gap-5 border border-border bg-surface p-6">
    <div><h2 className="font-display text-2xl">Upload image</h2><p className="mt-2 text-sm text-muted-foreground">JPEG, PNG, or WebP, up to {formatBytes(MEDIA_MAX_BYTES)}. Files are normalized to metadata-free WebP.</p></div>
    <label className="grid gap-2 text-sm font-medium">Image file<input required disabled={pending} name="file" type="file" accept={MEDIA_ACCEPT} onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} className="min-h-12 border border-border bg-background p-3" /></label>
    {fileName && <p className="text-sm text-muted-foreground">Selected: {fileName}</p>}
    <label className="grid gap-2 text-sm font-medium">Alt text <span className="font-normal text-muted-foreground">Optional now; leave empty only when the eventual use is decorative.</span><input disabled={pending} maxLength={500} name="altText" className="min-h-12 border border-border bg-background px-4" /></label>
    <button disabled={pending} className="min-h-12 bg-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-60">{pending ? "Uploading and processing…" : "Upload image"}</button>
    <p role="status" aria-live="polite" className="min-h-5 text-sm">{message}</p>
  </form>;
}
