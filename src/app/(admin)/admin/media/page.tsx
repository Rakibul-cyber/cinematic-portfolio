/* eslint-disable @next/next/no-img-element */
import { AdminForm } from "@/components/admin/admin-form";
import { AdminShell } from "@/components/admin/admin-shell";
import { DeleteButton } from "@/components/admin/delete-button";

import {
  deleteMediaAction,
  updateMediaMetadataAction,
} from "@/app/(admin)/admin/media/actions";
import { UploadForm } from "@/app/(admin)/admin/media/upload-form";
import { ADMIN_MEDIA_PATH } from "@/lib/admin-routes";
import { formatBytes } from "@/lib/media";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { mediaUrl } from "@/server/media/r2";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const user = await requireUser(ADMIN_MEDIA_PATH);
  const media = await prisma.media.findMany({
    orderBy: { createdAt: "desc" },
    include: { variants: true, createdBy: { select: { name: true } } },
  });

  return (
    // Inside the shared shell (predates it otherwise) for the same navigation, skip link and main region as every other admin page.
    <AdminShell user={user} title="Media library">
      <UploadForm />
      <section className="mt-10" aria-labelledby="library-heading">
        <h2 id="library-heading" className="mb-4 font-display text-2xl">
          Images ({media.length})
        </h2>
        {media.length === 0 ? (
          <p className="border border-dashed border-border p-8 text-center text-muted-foreground">
            No media uploaded yet.
          </p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {media.map((item) => {
              const thumbnail = item.variants.find(
                (variant) => variant.variant === "THUMBNAIL",
              );
              return (
                <li key={item.id} className="border border-border bg-surface">
                  <div className="aspect-[4/3] overflow-hidden bg-muted">
                    {/* R2 already serves the purpose-built 320px derivative. */}
                    {thumbnail && (
                      <img
                        src={mediaUrl(thumbnail.objectKey)}
                        alt={item.altText ?? ""}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="grid gap-3 p-4 text-sm">
                    <p
                      className="truncate font-medium"
                      title={item.originalName}
                    >
                      {item.originalName}
                    </p>
                    <p className="text-muted-foreground">
                      {item.width} × {item.height} ·{" "}
                      {formatBytes(item.sizeBytes)}
                    </p>
                    <p className="text-muted-foreground">
                      Uploaded by {item.createdBy.name} ·{" "}
                      {item.createdAt.toLocaleDateString()}
                    </p>
                    <form
                      action={updateMediaMetadataAction}
                      className="grid gap-2"
                    >
                      <input type="hidden" name="id" value={item.id} />
                      <label className="grid gap-1">
                        <span>
                          Alt text
                          {/* Every card repeats these labels; the file name tells the fields apart for assistive technology. */}
                          <span className="sr-only"> for {item.originalName}</span>
                        </span>
                        <input
                          className="min-h-10 border border-border bg-background px-3"
                          maxLength={500}
                          name="altText"
                          defaultValue={item.altText ?? ""}
                        />
                      </label>
                      <label className="grid gap-1">
                        <span>
                          Caption
                          <span className="sr-only"> for {item.originalName}</span>
                        </span>
                        <input
                          className="min-h-10 border border-border bg-background px-3"
                          maxLength={2000}
                          name="caption"
                          defaultValue={item.caption ?? ""}
                        />
                      </label>
                      <button className="min-h-10 border border-border px-4 text-xs font-semibold tracking-wider uppercase hover:border-foreground">
                        Save metadata
                        <span className="sr-only"> for {item.originalName}</span>
                      </button>
                    </form>
                    {/* An image still used by a project is refused; the reason appears here, beside it. */}
                    <AdminForm action={deleteMediaAction} className="grid gap-2">
                      <input type="hidden" name="id" value={item.id} />
                      <DeleteButton itemName={item.originalName}>Delete image and all variants</DeleteButton>
                    </AdminForm>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
