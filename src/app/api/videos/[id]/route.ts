import { handleDeleteVideo } from "@/server/video/http";
import { videoRouteDependencies } from "@/server/video/route-deps";

/** Permanently deletes an unassigned video at the provider and here (ADMIN/SUPER_ADMIN). Never cached. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return handleDeleteVideo(request, id, videoRouteDependencies());
}
