import {
  deleteAction,
  saveSettingsAction,
  saveSocialAction,
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
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; editSocial?: string }>;
}) {
  const user = await requireAdmin("/admin/settings");
  const [settings, links] = await Promise.all([
    prisma.siteSetting.findUnique({ where: { id: "primary" } }),
    prisma.socialLink.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);
  const { error, editSocial } = await searchParams;
  const currentSocial = links.find((link) => link.id === editSocial);
  return (
    <AdminShell user={user} title="Settings">
      <Notice message={error} />
      <form
        action={saveSettingsAction}
        className="grid gap-3 border border-border p-5 sm:grid-cols-2"
      >
        <label>
          Studio name
          <input
            className={inputClass}
            name="studioName"
            defaultValue={settings?.studioName ?? ""}
            required
          />
        </label>
        <label>
          Tagline
          <input
            className={inputClass}
            name="tagline"
            defaultValue={settings?.tagline ?? ""}
          />
        </label>
        <label>
          Contact email
          <input
            className={inputClass}
            type="email"
            name="contactEmail"
            defaultValue={settings?.contactEmail ?? ""}
          />
        </label>
        <label>
          Contact phone
          <input
            className={inputClass}
            name="contactPhone"
            defaultValue={settings?.contactPhone ?? ""}
          />
        </label>
        <label>
          WhatsApp
          <input
            className={inputClass}
            name="whatsappNumber"
            defaultValue={settings?.whatsappNumber ?? ""}
          />
        </label>
        <label>
          Location
          <input
            className={inputClass}
            name="locationText"
            defaultValue={settings?.locationText ?? ""}
          />
        </label>
        <label>
          Footer copyright
          <input
            className={inputClass}
            name="footerCopyright"
            defaultValue={settings?.footerCopyright ?? ""}
          />
        </label>
        <label>
          Default SEO title
          <input
            className={inputClass}
            name="defaultSeoTitle"
            defaultValue={settings?.defaultSeoTitle ?? ""}
          />
        </label>
        <label className="sm:col-span-2">
          Default SEO description
          <textarea
            className={areaClass}
            name="defaultSeoDescription"
            defaultValue={settings?.defaultSeoDescription ?? ""}
          />
        </label>
        <button className={buttonClass}>Save settings</button>
      </form>
      <h2 className="mt-10 font-display text-2xl">Social links</h2>
      <form
        action={saveSocialAction}
        className="mt-3 grid gap-3 border border-border p-5 sm:grid-cols-2"
      >
        {currentSocial && <input type="hidden" name="id" value={currentSocial.id} />}
        <label>
          Platform
          <input className={inputClass} name="platform" defaultValue={currentSocial?.platform} required />
        </label>
        <label>
          Label
          <input className={inputClass} name="label" defaultValue={currentSocial?.label} required />
        </label>
        <label>
          URL
          <input className={inputClass} type="url" name="url" defaultValue={currentSocial?.url} required />
        </label>
        <label>
          Order
          <input
            className={inputClass}
            type="number"
            name="sortOrder"
            defaultValue={currentSocial?.sortOrder ?? 0}
          />
        </label>
        <label>
          <input type="checkbox" name="isActive" defaultChecked={currentSocial?.isActive ?? true} /> Active
        </label>
        <button className={buttonClass}>{currentSocial ? "Save social link" : "Add social link"}</button>
      </form>
      <ul className="mt-5 grid gap-2">
        {links.map((l) => (
          <li
            className="flex justify-between border border-border p-3"
            key={l.id}
          >
            <span>
              {l.label} · {l.platform} · order {l.sortOrder}
            </span>
            <Link className="underline" href={`/admin/settings?editSocial=${l.id}`}>Edit</Link>
            <form action={deleteAction}>
              <input type="hidden" name="kind" value="socialLink" />
              <input type="hidden" name="id" value={l.id} />
                <DeleteButton />
            </form>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}
