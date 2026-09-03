import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { Container } from "@/components/ui/container";
import { siteContent } from "@/content/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 h-[var(--header-height)] border-b border-border bg-background">
      <Container className="flex h-full items-center justify-between">
        <a
          aria-label={`${siteContent.brand.name}, home`}
          className="flex min-h-12 flex-col justify-center"
          href="#top"
        >
          <span className="text-xs font-semibold tracking-[0.18em] uppercase">
            {siteContent.brand.name}
          </span>
          <span className="mt-1 text-[0.5625rem] tracking-[0.15em] text-muted-foreground uppercase">
            {siteContent.brand.descriptor}
          </span>
        </a>

        <nav aria-label="Primary navigation" className="hidden md:block">
          <ul className="flex items-center gap-7 lg:gap-10">
            {siteContent.navigation.map((item) => (
              <li key={item.href}>
                <a
                  className="inline-flex min-h-12 items-center text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                  href={item.href}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <MobileNavigation />
      </Container>
    </header>
  );
}
