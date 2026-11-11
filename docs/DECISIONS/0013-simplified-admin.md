# ADR 0013: Simplified admin without categories and testimonials

| Field | Value |
| --- | --- |
| Status | Accepted (owner decision, 2026-11-11). Committed to `main` and pushed 2026-11-12 with owner approval; deployment UNVERIFIED until the owner confirms the Netlify publish |
| Task | MH-15 |
| Supersedes | In part ADR 0004 and ADR 0005: category and testimonial management, the `/work` category filter and its per-request rendering, and the "published, in an active category" visibility rule (as relaxed by MH-13) |

## Context

The admin is used by a non-technical studio owner. Categories and Testimonials
were two of its sections, with their own pages, dashboard counters, shortcuts,
and public output (a filter on `/work`, category labels, testimonial blocks),
yet neither is used in production: the owner's production QA runs (2026-11-11)
show zero categories and zero testimonials. Since MH-13 a project needs no
category, and the project editor has no category control.

The unused sections made the navigation and the dashboard longer than the
owner's everyday work (projects, media, inquiries) needs.

## Decision

1. Remove categories from the application: the admin page `/admin/categories`,
   `saveCategoryAction`, the `category` branch of `deleteAction`,
   `saveCategory`, `deleteCategory`, `ReferencedCategoryError`,
   `categorySchema`, the public category filter (`category-filter.tsx`,
   `getPublicCategories`, the `?category=` handling on `/work`), the category
   label on project cards, the project page, and the home hero, the "Category"
   fact on the project page, the `genre` field in project structured data, the
   `PublicCategory` type, the cache tag `public:categories`, the `category`
   revalidation kind, and the category name in the admin project list.
2. Remove testimonials from the application: the admin page
   `/admin/testimonials`, `saveTestimonialAction`, the `testimonial` delete
   branch, `saveTestimonial`, `testimonialSchema`, `getActiveTestimonials`,
   `toPublicTestimonial`, `PublicTestimonial`, the testimonial section and list
   components and their use on `/`, `/about`, and `/services`, the cache tag
   `public:testimonials`, the `testimonial` revalidation kind, and the "In
   their words" section label.
3. A project is public exactly when its `status` is `PUBLISHED`.
   `PUBLISHED_PROJECT_WHERE` is `{ status: "PUBLISHED" }`; the MH-13 condition
   "no category, or an active category" is gone.
4. Keep the database schema unchanged. `prisma/schema.prisma` still has the
   models `PortfolioCategory` and `Testimonial` and the nullable column
   `project.categoryId` with its foreign key and index. No migration is added
   (still nine), and no table, column, or row is dropped or modified. The
   application no longer reads or writes them; a project save never writes
   `categoryId`.
5. `/work` takes no `searchParams` and exports `revalidate = 3600`, like the
   other public pages (static with tag revalidation).
6. Dashboard (`/admin`): six counters in this order: Projects, Published,
   Drafts, Media, New inquiries, Open inquiries. Three quick actions: "New
   project" (`/admin/projects/new`), "Upload media" (`/admin/media`), "View
   inquiries" (`/admin/inquiries`).
7. Admin navigation: six primary links in this order: Dashboard, Projects,
   Media, Inquiries, Customers, Settings (Settings only for ADMIN and
   SUPER_ADMIN). Below them, in the same `<nav aria-label="Admin">`, a small
   muted label "Website content" and a secondary group (`ADMIN_CONTENT_LINKS`):
   Services and Pages, rendered smaller (12px, muted). Both pages work as
   before and stay open to every signed-in role (delete still ADMIN). On
   mobile the group sits below the six links in the same Menu disclosure.
8. Project form: the collapsed section "Advanced details" is retitled "More
   options (optional)". No field is added or removed; every field is still
   submitted.
9. `deleteAction` accepts the kinds `project`, `service`, and `socialLink`
   only. `PublicContentKind` is `project | service | page | settings | media`.
   `AuditEntityType` loses its `Category` and `Testimonial` constants.

## Consequences

- No data loss and no migration: the tables and the column remain, so nothing
  has to be applied to any database before or after this change. Dropping them
  later needs its own approved migration.
- A published project in an inactive category would now be public. This was
  checked: production holds zero categories, and the foreign key
  `project.categoryId` → `portfolio_category.id` means no project can
  reference a category that does not exist, so no project changes visibility.
- `/work` is static and revalidated instead of rendered per request.
- Old `/work?category=...` links still work: they show the whole portfolio.
- `/admin/categories` and `/admin/testimonials` answer with the admin "Page
  not found" 404 through the existing catch-all.
- Historic audit rows that name a category or testimonial are untouched.
- Re-adding either feature means restoring the code (it remains in git
  history); the tables are still there.
- `src/app/(admin)/admin/simplified-admin.test.ts` (11 tests) locks the
  removal in. `scripts/verify-cms-flow.ts` and `scripts/verify-public-flow.ts`
  no longer create categories or testimonials; they were edited but NOT RUN
  (they need a database).
- Not yet deployed: the change exists only in the local working tree.
