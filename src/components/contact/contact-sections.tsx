import type { ReactNode } from "react";

import { type ContactDetails, contactDisciplines } from "@/content/site";

/**
 * Presentational sections of the contact page, free of data access so they
 * render in tests. Styling lives in `src/app/(public)/contact/contact.css`,
 * scoped under `.mv-contact`.
 *
 * Decorative glyphs are `aria-hidden`; every action's visible text is its name.
 */

export function ContactHero({ eyebrow, lead, title }: { eyebrow: string; lead: string; title?: string }) {
  return (
    <section aria-labelledby="contact-title" className="mv-hero">
      <div className="mv-wrap mv-hero-grid">
        <div>
          <p className="mv-eyebrow">{eyebrow}</p>
          <h1 className="mv-display" id="contact-title">
            {title ?? (
              <>
                Let&apos;s Create Something <em>Extraordinary.</em>
              </>
            )}
          </h1>
          <p className="mv-lead">{lead}</p>
        </div>
        <ol aria-label="Disciplines" className="mv-disciplines">
          {contactDisciplines.map((discipline, index) => (
            <li key={discipline}>
              <span aria-hidden="true" className="mv-numeral">{String(index + 1).padStart(2, "0")}</span>
              {discipline}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Left column beside the form, shared by the open and closed inquiry states. */
export function InquiryIntro({ children }: { children?: ReactNode }) {
  return (
    <div className="mv-inquiry-intro">
      <h2 className="mv-h2">Tell us about your story.</h2>
      {children}
    </div>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" className="mv-icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" viewBox="0 0 24 24">
      <path d={path} />
    </svg>
  );
}

function DirectCard({ action, children, icon, label }: { action?: { href: string; label: string }; children: ReactNode; icon: string; label: string }) {
  return (
    <div className="mv-card">
      <dt className="mv-label">
        <Icon path={icon} />
        {label}
      </dt>
      <dd className="mv-card-value">{children}</dd>
      {action ? (
        <dd className="mv-card-action">
          <a className="mv-action" href={action.href}>{action.label}</a>
        </dd>
      ) : null}
    </div>
  );
}

export function DirectContact({ children, details }: { children?: ReactNode; details: ContactDetails }) {
  const { addressLines, business, email, phoneDisplay, phoneHref } = details;

  return (
    <section aria-labelledby="direct-contact-title" className="mv-direct" id="direct-contact">
      <div className="mv-wrap">
        <h2 className="mv-h2" id="direct-contact-title">Contact {business} Directly</h2>
        <dl className="mv-cards">
          <DirectCard action={{ href: `mailto:${email}`, label: "Write an email" }} icon="M3 6h18v12H3zM3 7l9 7 9-7" label="Business email">
            {email}
          </DirectCard>
          <DirectCard action={{ href: phoneHref, label: "Call" }} icon="M6 3h4l1.5 5-2.5 1.5a11 11 0 0 0 5.5 5.5L16 12.5l5 1.5v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" label="Phone">
            {phoneDisplay}
          </DirectCard>
          <DirectCard icon="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" label="Business address">
            <address>
              {addressLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
          </DirectCard>
        </dl>
        {children}
      </div>
    </section>
  );
}

export function BrandStatement() {
  return (
    <section aria-label="Brand statement" className="mv-statement">
      <div className="mv-wrap">
        <span aria-hidden="true" className="mv-rule" />
        <p className="mv-statement-text">
          Your Story Deserves to Be Told <em>Beautifully.</em>
        </p>
        <p className="mv-eyebrow mv-signature">Munir Visuals — Photography &amp; Film</p>
      </div>
    </section>
  );
}
