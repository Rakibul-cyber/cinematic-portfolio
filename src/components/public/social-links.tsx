import { cn } from "@/lib/utils";
import type { PublicSocialLink } from "@/server/public/view-models";

type SocialLinksProps = {
  links: readonly PublicSocialLink[];
  /** Names the list for assistive technology; the list itself is unlabelled. */
  label?: string;
  className?: string;
};

/**
 * Active social profiles.
 *
 * No platform is assumed to exist — the studio's own labels are rendered, in
 * their configured order, and the block disappears when nothing is active.
 * Links open in a new tab with `rel="noopener noreferrer"`, and the link text
 * names the destination rather than saying "link".
 */
export function SocialLinks({ className, label, links }: SocialLinksProps) {
  if (links.length === 0) return null;

  return (
    <ul aria-label={label} className={cn("flex flex-wrap gap-x-6 gap-y-1", className)}>
      {links.map((link) => (
        <li key={`${link.platform}-${link.href}`}>
          <a
            className="inline-flex min-h-11 items-center text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-accent"
            href={link.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
