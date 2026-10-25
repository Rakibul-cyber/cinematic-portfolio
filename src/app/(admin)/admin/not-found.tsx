import { AdminNotFoundView } from "@/components/admin/admin-status";

/**
 * Admin 404, for `notFound()` in admin pages (a deleted project, customer or
 * inquiry) and for unknown admin addresses via `[...missing]`. Without it those
 * fell through to the root 404 and drew the public site's header and footer
 * inside the admin area.
 */
export default function AdminNotFound() {
  return <AdminNotFoundView />;
}
