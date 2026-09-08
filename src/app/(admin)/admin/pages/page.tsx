import { savePageAction } from "@/app/(admin)/admin/cms-actions";
import {
  AdminShell,
  Notice,
  areaClass,
  buttonClass,
  inputClass,
} from "@/components/admin/admin-shell";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
const keys = ["about", "contact", "services"] as const;
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser("/admin/pages");
  const rows = await prisma.page.findMany();
  const { error } = await searchParams;
  return (
    <AdminShell user={user} title="Pages">
      <Notice message={error} />
      <div className="grid gap-5">
        {keys.map((key) => {
          const row = rows.find((r) => r.key === key);
          return (
            <form
              action={savePageAction}
              className="grid gap-3 border border-border p-5"
              key={key}
            >
              <input type="hidden" name="key" value={key} />
              <h2 className="font-display text-2xl capitalize">{key}</h2>
              <label>
                Eyebrow
                <input
                  className={inputClass}
                  name="eyebrow"
                  defaultValue={row?.eyebrow ?? ""}
                />
              </label>
              <label>
                Title
                <input
                  className={inputClass}
                  name="title"
                  defaultValue={row?.title ?? ""}
                  required
                />
              </label>
              <label>
                Body
                <textarea
                  className={areaClass}
                  name="body"
                  defaultValue={row?.body ?? ""}
                  required
                />
              </label>
              <label>
                SEO title
                <input
                  className={inputClass}
                  name="seoTitle"
                  defaultValue={row?.seoTitle ?? ""}
                />
              </label>
              <label>
                SEO description
                <textarea
                  className={areaClass}
                  name="seoDescription"
                  defaultValue={row?.seoDescription ?? ""}
                />
              </label>
              <button className={buttonClass}>Save {key}</button>
            </form>
          );
        })}
      </div>
    </AdminShell>
  );
}
