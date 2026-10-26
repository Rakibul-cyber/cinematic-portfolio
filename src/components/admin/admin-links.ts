import { isAdministrative, type AdminRole } from "@/server/auth/roles";

/**
 * Admin navigation. `adminOnly` mirrors the server guard: the Settings page and
 * its actions call `requireAdmin`, so an EDITOR is not offered the link. Hiding
 * it is a courtesy only; the guard still decides.
 */
const LINKS: readonly { label: string; href: string; adminOnly?: true }[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Inquiries", href: "/admin/inquiries" },
  { label: "Customers", href: "/admin/customers" },
  { label: "Projects", href: "/admin/projects" },
  { label: "Categories", href: "/admin/categories" },
  { label: "Media", href: "/admin/media" },
  { label: "Services", href: "/admin/services" },
  { label: "Testimonials", href: "/admin/testimonials" },
  { label: "Pages", href: "/admin/pages" },
  { label: "Settings", href: "/admin/settings", adminOnly: true },
];

/** The navigation links `role` can use. */
export function adminLinksFor(role: AdminRole) {
  const admin = isAdministrative(role);
  return LINKS.filter((link) => admin || !link.adminOnly);
}
