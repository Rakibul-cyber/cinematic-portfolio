import type { ReactNode } from "react";

import { PageIntro } from "@/components/public/page-intro";
import { Container } from "@/components/ui/container";

export type LegalSection = {
  title: string;
  content: ReactNode;
};

export function LegalDocument({
  eyebrow,
  title,
  language,
  counterpartHref,
  counterpartLabel,
  sections,
}: {
  eyebrow: string;
  title: string;
  language: "de" | "en";
  counterpartHref: string;
  counterpartLabel: string;
  sections: LegalSection[];
}) {
  return (
    <main id="main-content" lang={language}>
      <PageIntro eyebrow={eyebrow} title={title} />
      <Container className="pb-24 sm:pb-32">
        <div className="max-w-3xl border-t border-border pt-10">
          <div className="border border-red-400/70 p-5" role="note">
            <p className="font-semibold tracking-[0.08em] uppercase">
              {language === "de"
                ? "Entwurf – nicht zur Veröffentlichung freigegeben"
                : "Draft – not approved for publication"}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {language === "de"
                ? "Alle TODO-Angaben müssen durch die verantwortliche Person ergänzt und der vollständige Text rechtlich geprüft werden."
                : "The responsible person must complete every TODO and obtain legal review of the full text."}
            </p>
          </div>
          <p className="mt-6 text-sm">
            <a className="underline underline-offset-4" href={counterpartHref}>
              {counterpartLabel}
            </a>
          </p>
          <div className="mt-12 grid gap-12">
            {sections.map((section, index) => {
              const headingId = `legal-section-${index + 1}`;

              return (
                <section aria-labelledby={headingId} key={section.title}>
                  <h2 className="font-display text-3xl" id={headingId}>
                    {section.title}
                  </h2>
                  <div className="mt-4 grid gap-4 text-sm leading-7 text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground">
                    {section.content}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </Container>
    </main>
  );
}
