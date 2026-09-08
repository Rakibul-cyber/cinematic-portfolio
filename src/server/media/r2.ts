import "server-only";
import { DeleteObjectsCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const schema = z.object({ R2_ACCOUNT_ID: z.string().min(1), R2_ACCESS_KEY_ID: z.string().min(1), R2_SECRET_ACCESS_KEY: z.string().min(1), R2_BUCKET_NAME: z.string().min(1), R2_PUBLIC_BASE_URL: z.string().url() });
export type R2Config = z.infer<typeof schema>;
let cached: { config: R2Config; client: S3Client } | undefined;

export function getR2() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error("R2 media storage is not configured. Set the documented R2 variables in .env.local.");
  const config = parsed.data;
  const client = new S3Client({ region: "auto", endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY } });
  cached = { config, client };
  return cached;
}

export async function putR2Object(key: string, body: Buffer): Promise<void> {
  const { client, config } = getR2();
  await client.send(new PutObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key, Body: body, ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
}
export async function deleteR2Objects(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const { client, config } = getR2();
  const result = await client.send(new DeleteObjectsCommand({ Bucket: config.R2_BUCKET_NAME, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
  if (result.Errors?.length) throw new Error("R2 did not delete every requested media object.");
}
export function mediaUrl(key: string): string { return `${getR2().config.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`; }

export async function r2ObjectExists(key: string): Promise<boolean> {
  const { client, config } = getR2();
  try { await client.send(new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key })); return true; }
  catch (error) { const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode; if (status === 404) return false; throw error; }
}
