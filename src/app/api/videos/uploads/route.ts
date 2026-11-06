import { handleCreateUpload } from "@/server/video/http";
import { videoRouteDependencies } from "@/server/video/route-deps";

/** Starts a direct upload to the video provider (ADMIN/SUPER_ADMIN). Never cached. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleCreateUpload(request, videoRouteDependencies());
}
