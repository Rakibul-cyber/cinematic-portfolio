import { handleCancelUpload } from "@/server/video/http";
import { videoRouteDependencies } from "@/server/video/route-deps";

/** Cancels a pending direct upload (ADMIN/SUPER_ADMIN). Never cached. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return handleCancelUpload(request, id, videoRouteDependencies());
}
