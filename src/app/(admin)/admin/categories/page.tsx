import {
  deleteAction,
  saveCategoryAction,
} from "@/app/(admin)/admin/cms-actions";
import Link from "next/link";
import { DeleteButton } from "@/components/admin/delete-button";
import {
  AdminShell,
  Notice,
  areaClass,
  buttonClass,
  inputClass,
} from "@/components/admin/admin-shell";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; edit?: string }>;
}) {
  const user = await requireUser("/admin/categories");
  const rows = await prisma.portfolioCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const { error, edit } = await searchParams;
  const current = rows.find((row) => row.id === edit);
  return (
    <AdminShell user={user} title="Categories">
      <Notice message={error} />
      <form
        action={saveCategoryAction}
        className="grid gap-3 border border-border p-5 sm:grid-cols-2"
      >
        {current && <input type="hidden" name="id" value={current.id} />}
        <label>
          Name
          <input className={inputClass} name="name" defaultValue={current?.name} required />
        </label>
        <label>
          Slug
          <input
            className={inputClass}
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            defaultValue={current?.slug}
            required
          />
        </label>
        <label className="sm:col-span-2">
          Description
          <textarea className={areaClass} name="description" defaultValue={current?.description ?? ""} />
        </label>
        <label>
          Order
          <input
            className={inputClass}
            name="sortOrder"
            type="number"
            defaultValue={current?.sortOrder ?? 0}
          />
        </label>
        <label>
          <input name="isActive" type="checkbox" defaultChecked={current?.isActive ?? true} /> Active
        </label>
        <button className={buttonClass}>{current ? "Save category" : "Create category"}</button>
      </form>
      <ul className="mt-8 grid gap-3">
        {rows.length ? (
          rows.map((r) => (
            <li
              className="flex justify-between border border-border p-4"
              key={r.id}
            >
              <span>
                {r.name} · {r.slug} · order {r.sortOrder} ·{" "}
                {r.isActive ? "active" : "inactive"}
              </span>
              <div className="flex gap-3"><Link className="underline" href={`/admin/categories?edit=${r.id}`}>Edit</Link><form action={deleteAction}>
                <input type="hidden" name="kind" value="category" />
                <input type="hidden" name="id" value={r.id} />
                <DeleteButton />
              </form></div>
            </li>
          ))
        ) : (
          <li>No categories yet.</li>
        )}
      </ul>
    </AdminShell>
  );
}
