import { handleMuxWebhookRequest } from "@/server/video/http";
import { videoRouteDependencies } from "@/server/video/route-deps";

/** Mux webhook receiver. Authenticated by its HMAC signature over the raw body. Never cached. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleMuxWebhookRequest(request, videoRouteDependencies());
}
