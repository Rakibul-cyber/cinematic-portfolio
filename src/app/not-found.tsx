import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { NotFoundContent } from "@/components/public/not-found-content";

/**
 * Global 404 for addresses that match no route group at all. It renders the
 * public chrome itself, because only the bare root layout wraps this file.
 */
export default function NotFound() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader />
      <NotFoundContent />
      <SiteFooter />
    </>
  );
}
