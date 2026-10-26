import Link from "next/link";
import {
  deleteAction,
  saveTestimonialAction,
} from "@/app/(admin)/admin/cms-actions";
import { AdminForm } from "@/components/admin/admin-form";
import { DeleteButton } from "@/components/admin/delete-button";
import {
  AdminShell,
  Notice,
  areaClass,
  buttonClass,
  inputClass,
} from "@/components/admin/admin-shell";
import { isAdministrative } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; edit?: string }>;
}) {
  const user = await requireUser("/admin/testimonials");
  // Deleting calls `requireAdmin`; an EDITOR is not offered a control that would be refused.
  const canDelete = isAdministrative(user.role);
  const rows = await prisma.testimonial.findMany({
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
  });
  const { error, edit } = await searchParams;
  const current = rows.find((row) => row.id === edit);
  return (
    <AdminShell user={user} title="Testimonials">
      <Notice message={error} />
      {/* Keyed per record: `?edit=` navigation re-renders without remounting, and uncontrolled fields would keep the previous record's values. */}
      <AdminForm
        action={saveTestimonialAction}
        className="grid gap-3 border border-border p-5 sm:grid-cols-2"
        key={current?.id ?? "new"}
      >
        {current && <input type="hidden" name="id" value={current.id} />}
        <label className="sm:col-span-2">
          Quote
          <textarea className={areaClass} name="quote" defaultValue={current?.quote} required />
        </label>
        <label>
          Author
          <input className={inputClass} name="authorName" defaultValue={current?.authorName} required />
        </label>
        <label>
          Role
          <input className={inputClass} name="authorRole" defaultValue={current?.authorRole ?? ""} />
        </label>
        <label>
          Company
          <input className={inputClass} name="company" defaultValue={current?.company ?? ""} />
        </label>
        <label>
          Project
          <input className={inputClass} name="projectName" defaultValue={current?.projectName ?? ""} />
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
        <button className={buttonClass}>{current ? "Save testimonial" : "Create testimonial"}</button>
      </AdminForm>
      <ul className="mt-8 grid gap-3">
        {rows.length ? (
          rows.map((r) => (
            <li
              className="flex justify-between border border-border p-4"
              key={r.id}
            >
              <span>
                {r.authorName} · order {r.sortOrder} ·{" "}
                {r.isActive ? "active" : "inactive"}
                {" · "}<Link className="underline" href={`/admin/testimonials?edit=${r.id}`}>Edit</Link>
              </span>
              {canDelete ? (
                <form action={deleteAction}>
                  <input type="hidden" name="kind" value="testimonial" />
                  <input type="hidden" name="id" value={r.id} />
                  <DeleteButton />
                </form>
              ) : null}
            </li>
          ))
        ) : (
          <li>No testimonials added.</li>
        )}
      </ul>
    </AdminShell>
  );
}
