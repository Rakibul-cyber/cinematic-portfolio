import { isAdministrative, type AdminRole } from "@/server/auth/roles";

type AdminLink = { label: string; href: string; adminOnly?: true };

/**
 * Primary admin navigation: the six everyday sections (MH-15). `adminOnly`
 * mirrors the server guard: the Settings page and its actions call
 * `requireAdmin`, so an EDITOR is not offered the link. Hiding it is a
 * courtesy only; the guard still decides.
 */
const LINKS: readonly AdminLink[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Projects", href: "/admin/projects" },
  { label: "Media", href: "/admin/media" },
  { label: "Inquiries", href: "/admin/inquiries" },
  { label: "Customers", href: "/admin/customers" },
  { label: "Settings", href: "/admin/settings", adminOnly: true },
];

/**
 * Secondary group, shown under "Website content" below the primary links.
 * Rarely edited, so kept out of the main list; both pages work exactly as
 * before and are open to every signed-in role, as their guards are.
 */
export const ADMIN_CONTENT_LINKS: readonly AdminLink[] = [
  { label: "Services", href: "/admin/services" },
  { label: "Pages", href: "/admin/pages" },
];

/** The primary navigation links `role` can use. */
export function adminLinksFor(role: AdminRole) {
  const admin = isAdministrative(role);
  return LINKS.filter((link) => admin || !link.adminOnly);
}
