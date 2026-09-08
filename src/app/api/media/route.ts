import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { MediaValidationError } from "@/server/media/processing";
import { uploadMedia } from "@/server/media/service";
import { MEDIA_MAX_BYTES } from "@/lib/media";

export const runtime = "nodejs";
const metadataSchema = z.object({ altText: z.string().trim().max(500).optional() });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MEDIA_MAX_BYTES + 64 * 1024) return NextResponse.json({ message: "The image exceeds the 15 MB upload limit." }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const parsed = metadataSchema.safeParse({ altText: form.get("altText") });
    if (!(file instanceof File)) return NextResponse.json({ message: "Choose an image to upload." }, { status: 400 });
    if (!parsed.success) return NextResponse.json({ message: "Alt text must be 500 characters or fewer." }, { status: 400 });
    const media = await uploadMedia(file, parsed.data.altText || null, user);
    return NextResponse.json({ id: media.id }, { status: 201 });
  } catch (error) {
    if (error instanceof MediaValidationError) return NextResponse.json({ message: error.message }, { status: 400 });
    console.error("[media] Upload failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ message: "The image could not be uploaded. Try again." }, { status: 500 });
  }
}
