import Link from "next/link";

import { deleteMediaAction, updateMediaMetadataAction } from "@/app/(admin)/admin/media/actions";
import { UploadForm } from "@/app/(admin)/admin/media/upload-form";
import { ADMIN_MEDIA_PATH, ADMIN_ROOT_PATH } from "@/lib/admin-routes";
import { formatBytes } from "@/lib/media";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { mediaUrl } from "@/server/media/r2";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  await requireUser(ADMIN_MEDIA_PATH);
  const media = await prisma.media.findMany({
    orderBy: { createdAt: "desc" },
    include: { variants: true, createdBy: { select: { name: true } } },
  });

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <header className="mb-8 flex items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-xs tracking-[.16em] text-muted-foreground uppercase">Media system</p>
          <h1 className="mt-2 font-display text-4xl">Media library</h1>
        </div>
        <Link href={ADMIN_ROOT_PATH} className="text-sm underline">Admin home</Link>
      </header>
      <UploadForm />
      <section className="mt-10" aria-labelledby="library-heading">
        <h2 id="library-heading" className="mb-4 font-display text-2xl">Images ({media.length})</h2>
        {media.length === 0 ? (
          <p className="border border-dashed border-border p-8 text-center text-muted-foreground">No media uploaded yet.</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {media.map((item) => {
              const thumbnail = item.variants.find((variant) => variant.variant === "THUMBNAIL");
              return (
                <li key={item.id} className="border border-border bg-surface">
                  <div className="aspect-[4/3] overflow-hidden bg-muted">
                    {/* R2 already serves the purpose-built 320px derivative. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumbnail && <img src={mediaUrl(thumbnail.objectKey)} alt={item.altText ?? ""} className="h-full w-full object-cover" />}
                  </div>
                  <div className="grid gap-3 p-4 text-sm">
                    <p className="truncate font-medium" title={item.originalName}>{item.originalName}</p>
                    <p className="text-muted-foreground">{item.width} × {item.height} · {formatBytes(item.sizeBytes)}</p>
                    <p className="text-muted-foreground">Uploaded by {item.createdBy.name} · {item.createdAt.toLocaleDateString()}</p>
                    <form action={updateMediaMetadataAction} className="grid gap-2">
                      <input type="hidden" name="id" value={item.id} />
                      <label className="grid gap-1">Alt text<input className="min-h-10 border border-border bg-background px-3" maxLength={500} name="altText" defaultValue={item.altText ?? ""} /></label>
                      <label className="grid gap-1">Caption<input className="min-h-10 border border-border bg-background px-3" maxLength={2000} name="caption" defaultValue={item.caption ?? ""} /></label>
                      <button className="min-h-10 border border-border px-4 text-xs font-semibold tracking-wider uppercase hover:border-foreground">Save metadata</button>
                    </form>
                    <form action={deleteMediaAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <button className="min-h-10 w-full border border-border px-4 text-xs font-semibold tracking-wider uppercase hover:border-foreground">Delete image and all variants</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
