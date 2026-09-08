# ADR 0003: Processed website media in Cloudflare R2

## Status

Accepted for Phase 3.

## Decision

Authenticated image uploads pass through a Next.js Route Handler. The application validates and processes each bounded in-memory file with Sharp, then writes a metadata-free WebP master and useful responsive variants to private-write R2 storage. This synchronous MVP path avoids temporary objects, presigned-upload lifecycle complexity, and a queue.

R2 stores optimized website assets, never RAW files or production archives. Keys use `media/YYYY/MM/<uuid>/<variant>.webp`; user filenames are metadata only. PostgreSQL stores provider, bucket, keys, dimensions, sizes, alt text, uploader, and a tiny blur placeholder. Delivery URLs are derived from `R2_PUBLIC_BASE_URL`, not persisted.

Widths are 320 (thumbnail), 640, 1280, and 1920 when smaller than the normalized master. The master is capped at 2560 pixels. Resizing preserves aspect ratio and never enlarges. Orientation-aware, metadata-free WebP encoding removes EXIF, GPS, and unnecessary camera metadata.

Public read delivery is acceptable for portfolio assets, while writes remain credentialed and server-only. Production DNS/CDN tuning remains Phase 10. Local development uses a separate development bucket, recommended as `cinematic-portfolio-media-dev`.

Deletion removes every object first and deletes the database row only after R2 confirms success. Future CMS relations must check references first. Replacements create a new media identity, switch future references, then retire the old item; objects are never overwritten in place.
