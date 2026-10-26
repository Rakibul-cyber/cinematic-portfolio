import { AdminForbiddenView } from "@/components/admin/admin-status";

/** Admin 403 rendered by Next.js for authenticated role denials. */
export default function AdminForbidden() {
  return <AdminForbiddenView />;
}
