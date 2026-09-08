# ADR 0004: Focused relational admin CMS

## Status

Accepted for Phase 4.

## Decision

The CMS remains part of the existing Next.js application and uses Prisma models rather than a generic CMS or page-builder framework. Content is plain text; arbitrary HTML and rich-text execution are not supported.

Projects use a simple `DRAFT` or `PUBLISHED` state. `publishedAt` is maintained with that state. `ProjectMedia` owns deterministic gallery order and the `COVER`, `HERO`, or `GALLERY` role, avoiding duplicate URL or cover fields on projects. Project deletion cascades only its join rows and never deletes reusable media.

Editors may create and edit normal content and relationships. Destructive actions and site settings require `ADMIN` or `SUPER_ADMIN`. All checks happen on the server. This deliberately avoids a granular permission engine.

Static copy is limited to stable `about`, `contact`, and `services` page keys. Global settings use one `primary` row, and social links remain ordered relational records. Secrets are never valid settings. SEO is limited to title/description fields on projects/pages and global defaults; public SEO rendering remains a later phase.

Media assigned to any project cannot be deleted. Administrators must detach it first. Database constraints back up the explicit preflight check.
