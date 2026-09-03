import { Container } from "@/components/ui/container";
import { siteContent } from "@/content/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-10 sm:py-12">
      <Container>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
          <div>
            <a
              aria-label={`${siteContent.brand.name}, back to top`}
              className="inline-block py-2 text-xs font-semibold tracking-[0.18em] uppercase"
              href="#top"
            >
              {siteContent.brand.name}
            </a>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {siteContent.footer.note}
            </p>
          </div>

          <nav aria-label="Footer navigation" className="lg:order-none">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {siteContent.navigation.map((item) => (
                <li key={item.href}>
                  <a
                    className="inline-flex min-h-11 items-center text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                    href={item.href}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <p className="text-xs text-muted-foreground sm:text-right">
            © {new Date().getFullYear()} {siteContent.brand.name}. Placeholder identity.
          </p>
        </div>
      </Container>
    </footer>
  );
}
