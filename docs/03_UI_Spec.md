# 03 — UI Design System Specification

| Field | Value |
| --- | --- |
| Document | `docs/03_UI_Spec.md` |
| Version | 1.1.0 (MH-10: cover-image poster, Google Drive, admin video link field) |
| Last reviewed | 2026-11-07 |
| Reviewed against | commit `4f7f564` (branch `docs/context-architecture`) |
| Document status | Locally maintained draft. This status does not imply owner approval, push, or deployment. |

## Purpose

This document records the design system **as implemented**: tokens, typography,
layout, components, and motion. Values are copied from the source. Inconsistencies
are listed separately in §9 and are not approved design requirements. No UI code
was changed to write it.

## Related documents

- Screens and states using these components: [02_AppFlow.md](02_AppFlow.md)
- Accessibility and responsiveness requirements: [01_PRD.md](01_PRD.md#4-nonfunctional-requirements)
- Styling toolchain versions: [04_TRD.md](04_TRD.md#1-locked-technology-baseline)

## Source references

`src/app/globals.css`, `src/app/(public)/contact/contact.css`,
`src/app/layout.tsx`, `src/lib/constants.ts`, `src/components/ui/*`,
`src/components/layout/*`, `src/components/public/*`, `src/components/sections/*`,
`src/components/motion/fade-reveal.tsx`, `src/components/admin/*`,
`postcss.config.mjs` (Tailwind CSS 4.3.3 through `@tailwindcss/postcss`).

---

## 1. Brand and visual identity

| ID | Principle | How the code expresses it |
| --- | --- | --- |
| UI-BR-01 | **Dark, cinematic canvas.** Near-black warm background, warm ivory text, one muted brass accent. | `:root` tokens in `globals.css`; `color-scheme: dark`; theme colour `#0f0f0e` |
| UI-BR-02 | **Editorial type.** A high-contrast serif display face for headings, a neutral sans for body and UI. | Cormorant Garamond (`--font-display`), Geist (`--font-sans`) |
| UI-BR-03 | **Media first.** Imagery fills large, fixed-ratio frames; text is small, spaced, and uppercase for labels. | `aspect-[4/5]`, `aspect-[16/10]`, `aspect-video`; `text-[0.625rem]`, `tracking-[0.16em]` |
| UI-BR-04 | **Hierarchy through scale and space, not decoration.** No rounded corners and no drop shadows in the shared system. | Zero `rounded-*` and zero `shadow-*` utilities in `src/` |
| UI-BR-05 | **Restrained motion.** A single upward reveal and slow hover scales; everything is disabled under reduced motion. | `FadeReveal`, `.work-card-visual` |
| UI-BR-06 | **The admin is functional, not cinematic.** Same tokens, plainer layout, dense controls. | `docs/ARCHITECTURE.md` (Admin application), `admin-styles.ts` |

## 2. Design tokens

### 2.1 Colour: global palette (`src/app/globals.css` `:root`)

| CSS variable | Tailwind name | Value | Purpose | Contrast on `--background` |
| --- | --- | --- | --- | --- |
| `--background` | `background` | `#0f0f0e` | Page canvas | — |
| `--foreground` | `foreground` | `#f1ede4` | Primary text | 16.41:1 |
| `--muted` | `muted` | `#262522` | Muted fills | — |
| `--muted-foreground` | `muted-foreground` | `#aaa49a` | Secondary text | 7.75:1 (7.25:1 on `--surface`) |
| `--surface` | `surface` | `#171715` | Raised areas, hover fills | — |
| `--surface-strong` | `surface-strong` | `#1d1c19` | Stronger raised areas, active admin nav | — |
| `--border` | `border` | `#34322e` | Hairlines, default border colour | 1.50:1 (decorative only) |
| `--input` | `input` | `#706b62` | Form control boundary | 3.62:1 (meets WCAG 1.4.11) |
| `--accent` | `accent` | `#a58a69` | Accent, focus outline, selection, solid buttons | 5.88:1 |
| `--accent-foreground` | `accent-foreground` | `#0f0f0e` | Text on accent | 5.88:1 on `--accent` |
| `--visual-ink` | — | `#151719` | Placeholder tone (default) | — |
| `--visual-stone` | — | `#625e56` | Placeholder tone `stone` | — |
| `--visual-umber` | — | `#4c3428` | Placeholder tone `umber` | — |
| `--visual-mark` | — | `#d7c8b4` | Placeholder mark (mixed at 28%) | — |

Ratios were computed with the WCAG 2 relative-luminance formula for this
document. Opacity variants used in components, such as `text-foreground/70`
and `border-foreground/55`, are not listed as tokens.

### 2.2 Colour: contact page palette (`contact.css`, scoped to `.mv-contact`)

The contact page overrides the global tokens on its own root element only.

| Variable | Value | Overrides | Contrast on `--mv-black` |
| --- | --- | --- | --- |
| `--mv-black` | `#0b0b0b` | `--background` | — |
| `--mv-charcoal` | `#171512` | `--surface` | — |
| `--mv-ivory` | `#f5f0e8` | `--foreground` | 17.35:1 |
| `--mv-gold` | `#c5a46d` | `--accent` | 8.35:1 |
| `--mv-gold-soft` | `#e8d8b8` | — | — |
| `--mv-field` | `#11100e` | — (field background) | — |
| `--mv-hairline` | `#2b2721` | `--border` | — |
| `--mv-field-border` | `#6b6355` | `--input` | 3.32:1 |
| `--mv-chip-border` | `#3d372e` | — | — |
| `--mv-muted` | `#a69d8f` | `--muted-foreground` | 7.35:1 |
| `--mv-subtle` | `#8c8476` | — | 5.32:1 |
| `--mv-error` | `#d99a86` | — (invalid field border) | 8.36:1 |

`--accent-foreground` becomes `--mv-black`.

### 2.3 Typography

| Token | Source | Family | Weights | Loading |
| --- | --- | --- | --- | --- |
| `--font-display` → `--font-display-source` | `next/font/google` `Cormorant_Garamond` | Cormorant Garamond, latin | 400, 500, 600 | `display: swap`, self-hosted at build |
| `--font-sans` → `--font-sans-source` | `next/font/google` `Geist` | Geist, latin, with `Arial, sans-serif` fallback on `body` | variable | `display: swap`, self-hosted at build |

**Font sizes in use.** Counts are occurrences in `src/components` and `src/app`.

| Utility | Size | Typical use |
| --- | --- | --- |
| `text-[0.5625rem]` | 9 px | Rare micro labels (2) |
| `text-[0.625rem]` | 10 px | Eyebrows, placeholder labels, video prompt (13) |
| `text-[0.6875rem]` | 11 px | Labels, metadata (18) |
| `text-xs` | 12 px | Buttons, admin labels (36) |
| `text-sm` | 14 px | Body and admin text (78) |
| `text-base` | 16 px | Body (9); contact form fields are fixed at `1rem` |
| `text-xl`, `text-2xl`, `text-3xl`, `text-4xl`, `text-5xl` | Tailwind default scale | Section and admin headings |
| `text-[clamp(2.5rem,6vw,6rem)]` … `text-[clamp(3.25rem,10vw,10.5rem)]` | Fluid, 9 distinct clamps | Display headlines (one per hero or page intro) |

**Weights:** `font-semibold` (46), `font-medium` (21), `font-normal` (1). The
display face is used through `font-display` (27).

**Line heights:** `leading-7` (16), `leading-6` (7), `leading-5` (3),
`leading-8` (2), `leading-relaxed` (1), `leading-[1.35]` (1), and tight display
values `leading-[0.82]`, `[0.86]`, `[0.88]`, `[0.9]`.

**Letter spacing:** label tracking `tracking-[0.12em]`–`[0.18em]` (most often
`0.18em`, `0.12em`, `0.16em`, `0.14em`) and `tracking-wider`; negative display
tracking `tracking-[-0.02em]`–`[-0.045em]`. The skip link uses `0.08em`.

### 2.4 Spacing, layout, and grid

| Token or rule | Value | Source |
| --- | --- | --- |
| Spacing scale | Tailwind CSS 4 default (`--spacing: 0.25rem` multiples) | Tailwind default |
| `--container` | `90rem` (1440 px), used as `max-w-[var(--container)]` by `Container` | `globals.css`, `src/components/ui/container.tsx` |
| `--header-height` | `4.75rem` (76 px); sticky header and mobile panel offset | `globals.css`, `site-header.tsx` |
| Admin shell | `max-w-7xl`, grid `md:grid-cols-[14rem_1fr]` | `admin-shell.tsx` |
| Reading widths | `max-w-md` to `max-w-5xl`, most often `max-w-xl` and `max-w-3xl` | components |
| Gallery grid | `grid gap-6 sm:gap-10 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-16` | `project-gallery.tsx` |
| Minimum page width | `html { min-width: 20rem }` (320 px) | `globals.css` |

### 2.5 Breakpoints

Tailwind CSS 4 defaults. The code uses only `sm`, `md`, and `lg`.

| Name | Min width | Uses in `src/` |
| --- | --- | --- |
| `sm` | 40rem (640 px) | 80 |
| `md` | 48rem (768 px) | 14 (mobile and desktop navigation switch, admin grid) |
| `lg` | 64rem (1024 px) | 96 |
| contact-only | `max-width: 56.24rem` (≈900 px) | `contact.css` |

`xl` and `2xl` are unused.

### 2.6 Radii, shadows, z-index

| Token | Value | Notes |
| --- | --- | --- |
| Border radius | None (square corners) | One exception: the contact form chip dot, `border-radius: 50%` |
| Shadows | None | One exception: the contact field focus ring `0 0 0 3px rgba(197, 164, 109, 0.16)` |
| `z-10` | Content above placeholders; mobile navigation panel | `hero-section.tsx`, `visual-placeholder.tsx`, `mobile-navigation.tsx` |
| `z-20` | Mobile menu toggle above its panel | `mobile-navigation.tsx` |
| `z-50` | Sticky site header | `site-header.tsx` |
| `z-index: 100` | Skip link | `globals.css` |

## 3. Theme rules

| ID | Rule |
| --- | --- |
| UI-TH-01 | **Dark only.** `color-scheme: dark` on `:root`, `colorScheme: "dark"` in the viewport, and theme colour `#0f0f0e`. There is no light theme, no `prefers-color-scheme` handling, and no theme toggle. |
| UI-TH-02 | Components use semantic Tailwind names (`bg-background`, `text-muted-foreground`, `border-input`), never raw hex values. The contact page sets its own values only through its scoped variables. |
| UI-TH-03 | Element defaults live in `@layer base`, so Tailwind utilities can override them (fixed in `675be39`). |
| UI-TH-04 | Selection uses `--accent` background with `--accent-foreground` text. |

## 4. Component specifications

States listed as "—" do not exist for that component. A state that should exist
but does not is listed in §9.

### 4.1 Navigation (`site-header.tsx`, `primary-nav.tsx`, `mobile-navigation.tsx`, `site-footer.tsx`)

| State | Behaviour |
| --- | --- |
| Default | Sticky header, `z-50`, `--header-height` tall, bottom border. Items: Work, Services, About, Contact. |
| Hover | Colour change to foreground or accent. |
| Focus | Global `:focus-visible` outline (2 px `--accent`, 4 px offset). |
| Active (current) | `aria-current="page"` for the current section (`isCurrentSection`). |
| Responsive | Below `md`: a 48 px toggle with `aria-expanded` and `aria-controls` opens a full-height panel under the header. `Escape` closes it, and body scrolling is locked while open. |
| Accessibility | Primary navigation is labelled; the skip link appears first on focus. The footer carries legal links only when the documents are approved. |

### 4.2 Buttons and links (`src/components/ui/button.tsx` `ButtonLink`; `admin-styles.ts` `buttonClass`)

Public `ButtonLink` renders an `<a>`. Variants:

| Variant | Default | Hover |
| --- | --- | --- |
| `solid` | `bg-accent text-accent-foreground border-accent` | `bg-foreground`, `border-foreground` |
| `outline` (default) | transparent, `border-border`, foreground text | `bg-foreground text-background` |
| `text` | no border, no horizontal padding | `text-accent` |

Shared: `min-h-12` (48 px), `px-5`, `text-xs font-semibold tracking-[0.12em]`
uppercase, `transition-colors duration-300`, and an optional arrow icon that
shifts 2 px up and right on hover.

| State | Behaviour |
| --- | --- |
| Focus | Global focus outline. |
| Active | — (no pressed style). |
| Disabled | — for `ButtonLink`, which is a link. Form submit buttons use the `disabled` attribute while pending. |
| Loading | Pending forms disable their submit button (login, upload, inquiry). |

The admin `buttonClass` is `min-h-10` (40 px), bordered, `text-xs font-semibold`,
uppercase, with `hover:border-foreground`.

### 4.3 Cards (`project-card.tsx`)

| State | Behaviour |
| --- | --- |
| Default | Media frame `aspect-[4/5]` or `aspect-[16/10]` with title and metadata below. |
| Hover | On fine pointers only, the image scales to 1.018 over 700 ms `cubic-bezier(0.22, 1, 0.36, 1)`. |
| Focus | Global outline on the card link. |
| Empty media | `VisualPlaceholder` (labelled `role="img"`) in place of an image. |

### 4.4 Forms and inputs

**Public inquiry form** (`inquiry-form-view.tsx`, `inquiry-fields.tsx`, contact styles):

| State | Behaviour |
| --- | --- |
| Default | `--mv-field` background, `--mv-field-border` border, 16 px text. |
| Hover | Border `--mv-subtle`. |
| Focus | Border and 1 px outline `--mv-gold`, plus the soft focus ring. |
| Error | `aria-invalid="true"` sets border `--mv-error`; messages are linked through `aria-describedby`; focus and scroll move to the feedback. |
| Disabled / loading | Submit disabled while pending, before a submission token exists, or when the form state is outdated. |
| Honeypot | Hidden `website` field. |

**Admin forms** (`admin-form.tsx`, `admin-styles.ts`):

| State | Behaviour |
| --- | --- |
| Default | `inputClass`: `min-h-10 w-full border border-border bg-background px-3`; `areaClass` for text areas `min-h-28`. |
| Error | `aria-invalid`, `aria-describedby` field errors; an alert summary (`role="alert"`) receives focus. Values are preserved (`c310487`). |
| Success | `Notice` with `role="status"` and `aria-live="polite"`. |

**Login form:** `aria-invalid` and `aria-describedby` per field; status in a
polite live region; the submit button is disabled while pending.

### 4.5 Galleries (`project-gallery.tsx`, `media-image.tsx`)

| Aspect | Behaviour |
| --- | --- |
| Layout | Single column, 12-column grid at `lg`. |
| Images | `<img srcSet sizes>` from R2 variants; `loading="lazy"` and `decoding="async"` unless `priority`, in which case `eager`/`sync`. |
| Placeholder | `blurDataUrl` painted as a background until load. |
| Responsive | `sizes` are declared per layout slot. |
| Accessibility | Alt text from the media library. Missing alt text is UNVERIFIED (the field is optional). |

### 4.6 Video player (`video-player.tsx`)

| State | Behaviour |
| --- | --- |
| Default (inactive) | A provider-free frame with a play control (64 px, 80 px at `sm`), a label, and a short privacy note. On project pages the project cover is shown behind it (local WebP variants, `loading="lazy"`, decorative `alt=""`, gradient `from-background/90`). **No request** goes to the provider. |
| Hover | Fill `hover:bg-surface` (`hover:bg-background/20` over a poster); control border and icon turn accent. |
| Focus | Global outline on the play button. |
| Active | Replaced by an `iframe` with `allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"`, in a `role="group"` labelled with the video name. |
| Error / unsupported | `EXTERNAL` provider: no embed URL, so the player is not rendered. |
| Responsive | Fills its container (`absolute inset-0`), inside an `aspect-video` frame. |

### 4.7 Dialogs and toasts

| Component | Implementation |
| --- | --- |
| Dialogs | None. Destructive confirmation uses the browser's `window.confirm("Delete this item? This cannot be undone.")` (`delete-button.tsx`). |
| Toasts | None. Feedback is the inline `Notice` (admin) and inline form feedback (public). |

### 4.8 Notices and status indicators

| Component | Behaviour |
| --- | --- |
| `Notice` (`admin-notice.tsx`) | `tone="alert"`: `role="alert"`, `border-accent`. `tone="status"`: `role="status"`, `aria-live="polite"`, `border-border`. Focusable for programmatic focus, with a visible ring. |
| Inquiry status | Text label in a bordered chip (`border-accent`), with a screen-reader prefix "Status: ". |
| Email delivery rows | Status, attempt count, recovery controls; possible-duplicate warning as `role="note"`. |
| Admin status pages | "Page not found" and "Access denied" (`admin-status.tsx`) with shortcut links. |

### 4.9 Tables and lists (admin)

| Aspect | Behaviour |
| --- | --- |
| Inquiries | Below `lg`: cards. At `lg`: a `<table>` with a screen-reader caption describing filter and range. Only one of the two is displayed at a time. |
| Customers, media, CMS lists | `<ul>` lists with dividers. |
| Pagination | `AdminPagination`, `aria-label="Pagination"`, 25 per page. |

### 4.10 Admin controls

| Component | Behaviour |
| --- | --- |
| `AdminShell` | Sidebar with studio label, user name and role, role-aware navigation, and sign-out. Main content `id="main-content"` after a skip link. |
| `AdminMenu` | Below `md`, a disclosure (`aria-expanded`, `aria-controls`, `Escape` closes). |
| `AdminNavLink` | `aria-current` for the active section; active style `border-accent bg-surface-strong`. While its navigation is pending it shows a 6 px accent dot (`motion-safe:animate-pulse`) and announces "Loading…" in a polite live region. |
| `DeleteButton` | Admin button style, confirm dialog, visually hidden item name for its accessible name. |
| `ProjectMediaPicker` | Assign images, roles, and order to a project. |

## 5. Media and motion

### 5.1 Image ratios and variants

| Context | Ratio |
| --- | --- |
| Project cards | `4/5` (portrait) and `16/10` (landscape) |
| Other frames | `4/3`, `video` (16/9) |
| Stored variants | Master WebP ≤ 2560 px; 320, 640, 1280, 1920 px wide when smaller than the master; never upscaled (ADR 0003) |

### 5.2 Video behaviour

Click-to-load only. No autoplay before activation; after activation the embed
URL requests autoplay (`autoplay=1`). YouTube uses `youtube-nocookie.com` with
`rel=0`, `modestbranding=1`, and `playsinline=1`; Vimeo uses `dnt=1`; Google
Drive uses `drive.google.com/file/d/<id>/preview` (no autoplay). The CSP
`frame-src` allows only those three hosts and Turnstile.

Admin (MH-10): the project form has one **Video link** field. The provider is
detected as the administrator types ("Detected: Google Drive"), refusals are
explained in plain words, and a valid link shows the same click-to-load player
as a preview (`project-video-field.tsx`).

### 5.3 Loading placeholders and fallbacks

| Case | Fallback |
| --- | --- |
| Image loading | Blur placeholder background |
| No image assigned | `VisualPlaceholder` with tone `ink`, `stone`, or `umber` and a framed mark |
| No video | Section or player omitted |
| No CMS content | Copy from `src/content/site.ts` (`emptyStates`, fallback metadata) |

### 5.4 Animation

| ID | Motion | Specification |
| --- | --- | --- |
| UI-MO-01 | `FadeReveal` | Translates from `y: 20` px to 0 over 0.7 s with ease `[0.22, 1, 0.36, 1]` (`MOTION_EASE`), once, when 18% is visible. Opacity is not animated. |
| UI-MO-02 | Card hover | `scale(1.018)` over 700 ms, fine pointers only. |
| UI-MO-03 | Colour transitions | `duration-300` (9) and `duration-200` (3); contact fields 250 ms. |
| UI-MO-04 | Skip link | `transform` 180 ms. |
| UI-MO-05 | Smooth scrolling | `html { scroll-behavior: smooth }`. |
| UI-MO-06 | Admin navigation pending dot | Tailwind `animate-pulse`, applied only under `motion-safe`. |

### 5.5 Reduced motion

Under `prefers-reduced-motion: reduce`:

- `FadeReveal` renders with no initial offset and no animation (`useReducedMotion`).
- Global CSS sets animation and transition durations to `0.01ms`, a single
  iteration, and `scroll-behavior: auto`.
- The contact page removes its hover arrow transforms.

## 6. Responsive behaviour summary

| Width | Behaviour |
| --- | --- |
| < 640 px | Single column, mobile navigation, compact padding |
| ≥ 640 px (`sm`) | Larger gaps and controls |
| ≥ 768 px (`md`) | Desktop navigation, admin sidebar grid |
| ≥ 1024 px (`lg`) | 12-column layouts, admin inquiry table |
| ≤ ≈900 px (contact) | Contact sections stack, reduced inline padding |

## 7. Accessibility requirements (implemented)

| ID | Requirement | Evidence |
| --- | --- | --- |
| UI-A11Y-01 | Visible focus on every interactive element (2 px accent outline, 4 px offset). | `globals.css` |
| UI-A11Y-02 | Skip link first in tab order on public and admin pages. | `globals.css`, `admin-shell.tsx` |
| UI-A11Y-03 | Form errors are announced and linked to fields. | admin and inquiry forms |
| UI-A11Y-04 | Control boundaries reach ≥ 3:1 contrast (`--input` 3.62:1). | `globals.css` comment |
| UI-A11Y-05 | Touch targets are at least 40 px (admin) and 48 px (public buttons, mobile toggle). | `min-h-10`, `min-h-12`, `size-12` |
| UI-A11Y-06 | Reduced motion respected everywhere (§5.5). | `globals.css`, `fade-reveal.tsx` |
| UI-A11Y-07 | Render tests assert accessible names, roles, and mobile behaviour. | `*.render-test.ts` (17 files) |

## 8. Approved design requirements

Only these are approved by the ADRs and ARCHITECTURE: dark cinematic public
presentation, a functional admin, centralized tokens (no scattered arbitrary
values), WCAG 2.2 AA as the target, and reduced-motion support
(`docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md` "Coding principles"). Any new
token, theme, or component needs a task in [06_Plan.md](06_Plan.md).

## 9. Existing inconsistencies

These describe the code as it is. They are not approved requirements.

| ID | Inconsistency | Impact |
| --- | --- | --- |
| UI-INC-01 | **Two palettes.** The contact page uses `--mv-*` values (for example background `#0b0b0b`, accent `#c5a46d`) that differ from the global `#0f0f0e` and `#a58a69`. Header and footer on `/contact` keep the global tokens. | Visible tone shift on one page; OD-12 |
| UI-INC-02 | **Arbitrary values despite the "centralize tokens" rule.** 9 distinct display `clamp()` sizes, 3 micro font sizes, and about 12 letter-spacing values are written inline. | Harder to keep consistent; OD-12 |
| UI-INC-03 | **Contact styling bypasses Tailwind** with a 603-line page stylesheet, while the rest of the site uses utilities. | Two styling approaches |
| UI-INC-04 | **Square-corner rule has one exception** (chip dot) and the no-shadow rule has one (contact focus ring). | Minor |
| UI-INC-05 | **No dialog or toast components.** The browser `confirm()` cannot be styled or reliably announced. | GAP-06 in 02_AppFlow |
| UI-INC-06 | **No route-level loading states.** Only admin navigation links show a pending indicator; public navigation shows none. A public `loading.tsx` must **not** be added, because it would turn draft-project 404s into soft 404s (`README.md`, "Caching"). | GAP-01 in 02_AppFlow |
| UI-INC-07 | **Temporary brand marks.** Favicon and app icons are a temporary "MV" mark (`ff2b834`); no final logo is in the repository. | `docs/CONTENT_CHECKLIST.md` brand items open |

## Open decisions

| ID | Decision |
| --- | --- |
| OD-12 | Unify the contact palette with the global tokens, or adopt the `--mv-*` palette site-wide. |
| OD-13 | Promote the repeated display sizes and tracking values into named tokens. |
| OD-14 | Replace `window.confirm` with an accessible confirmation component. |

Full register: [06_Plan.md](06_Plan.md#decision-register).

## Known limitations

- Values come from source inspection; no visual-regression or screenshot
  baseline exists.
- Contrast ratios cover token pairs only, not every opacity variant or text over
  images.
- No external accessibility audit has been performed.
