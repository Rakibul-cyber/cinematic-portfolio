import { forbidden } from "next/navigation";

import { VideoLibrary } from "@/app/(admin)/admin/videos/video-library";
import { AdminShell } from "@/components/admin/admin-shell";
import { ADMIN_VIDEOS_PATH } from "@/lib/video-library";
import { AuthorizationError, requireAdmin } from "@/server/auth/session";
import { loadAdminVideoLibrary } from "@/server/video/route-deps";

export const dynamic = "force-dynamic";

/**
 * Admin video library (P3-11D): ADMIN and SUPER_ADMIN only, like every video
 * route. An EDITOR gets the admin 403 screen; the routes refuse them too.
 */
export default async function VideosPage() {
  const user = await requireAdmin(ADMIN_VIDEOS_PATH).catch((error: unknown) => {
    if (error instanceof AuthorizationError) forbidden();
    throw error;
  });
  const library = await loadAdminVideoLibrary();
  return (
    <AdminShell user={user} title="Video library">
      <VideoLibrary
        videos={library.videos}
        uploadOrigin={library.uploadOrigin}
        uploadsUnavailableMessage={library.uploadsUnavailableMessage}
      />
    </AdminShell>
  );
}
