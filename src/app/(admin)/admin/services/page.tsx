import Link from "next/link";
import {
  deleteAction,
  saveServiceAction,
} from "@/app/(admin)/admin/cms-actions";
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
  const user = await requireUser("/admin/services");
  const rows = await prisma.service.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const { error, edit } = await searchParams;
  const current = rows.find((row) => row.id === edit);
  return (
    <AdminShell user={user} title="Services">
      <Notice message={error} />
      <form
        action={saveServiceAction}
        className="grid gap-3 border border-border p-5 sm:grid-cols-2"
      >
        {current && <input type="hidden" name="id" value={current.id} />}
        <label>
          Name
          <input className={inputClass} name="name" defaultValue={current?.name} required />
        </label>
        <label>
          Slug
          <input className={inputClass} name="slug" defaultValue={current?.slug} required />
        </label>
        <label>
          Short description
          <textarea className={areaClass} name="shortDescription" defaultValue={current?.shortDescription} required />
        </label>
        <label>
          Description
          <textarea className={areaClass} name="description" defaultValue={current?.description} required />
        </label>
        <label>
          Price label
          <input className={inputClass} name="priceLabel" defaultValue={current?.priceLabel ?? ""} />
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
        <button className={buttonClass}>{current ? "Save service" : "Create service"}</button>
      </form>
      <ul className="mt-8 grid gap-3">
        {rows.length ? (
          rows.map((r) => (
            <li
              className="flex justify-between border border-border p-4"
              key={r.id}
            >
              <span>
                {r.name} · {r.priceLabel || "No price"} · order {r.sortOrder} ·{" "}
                {r.isActive ? "active" : "inactive"}
                {" · "}<Link className="underline" href={`/admin/services?edit=${r.id}`}>Edit</Link>
              </span>
              <form action={deleteAction}>
                <input type="hidden" name="kind" value="service" />
                <input type="hidden" name="id" value={r.id} />
                <DeleteButton />
              </form>
            </li>
          ))
        ) : (
          <li>Create your first service.</li>
        )}
      </ul>
    </AdminShell>
  );
}
