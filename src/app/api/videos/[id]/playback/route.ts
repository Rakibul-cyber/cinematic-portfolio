import { handlePlayback } from "@/server/video/http";
import { videoRouteDependencies } from "@/server/video/route-deps";

/** Issues a short-lived signed playback URL: admin preview, or public via `?projectId=`. Never cached. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return handlePlayback(request, id, videoRouteDependencies());
}
