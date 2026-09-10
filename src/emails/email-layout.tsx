import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import type { EmailModel } from "@/emails/inquiry-content";

/**
 * Shared layout for both transactional emails.
 *
 * Deliberately plain: a light background, one system font stack, generous
 * spacing, and a single accent borrowed from the brand. The public site's dark
 * cinematic treatment is not reproduced here — dark backgrounds and web fonts
 * are the two things mail clients handle worst, and a portfolio inquiry email
 * has to survive Outlook as reliably as it survives Apple Mail.
 *
 * Every style is inline, there is no JavaScript, no webfont, no remote image,
 * and no tracking pixel. Content arrives as a plain data model and React Email
 * escapes it, so untrusted visitor text can never become markup.
 */

const BACKGROUND = "#f4f2ee";
const SURFACE = "#ffffff";
const INK = "#1c1b19";
const MUTED = "#6d675f";
const BORDER = "#e2ddd4";
const ACCENT = "#8a6f4e";

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function EmailLayout({ model }: { model: EmailModel }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{model.preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "32px 12px",
          backgroundColor: BACKGROUND,
          color: INK,
          fontFamily: FONT,
        }}
      >
        <Container
          style={{
            maxWidth: "600px",
            margin: "0 auto",
            padding: "40px",
            backgroundColor: SURFACE,
            border: `1px solid ${BORDER}`,
          }}
        >
          <Heading
            as="h1"
            style={{
              margin: "0 0 24px",
              fontSize: "22px",
              lineHeight: "30px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: INK,
            }}
          >
            {model.heading}
          </Heading>

          {model.intro.map((paragraph) => (
            <Text
              key={paragraph}
              style={{
                margin: "0 0 16px",
                fontSize: "15px",
                lineHeight: "24px",
                color: INK,
              }}
            >
              {paragraph}
            </Text>
          ))}

          {model.groups.map((group) => (
            <Section key={group.title} style={{ marginTop: "32px" }}>
              <Text
                style={{
                  margin: "0 0 12px",
                  fontSize: "11px",
                  lineHeight: "16px",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: ACCENT,
                }}
              >
                {group.title}
              </Text>
              {group.fields.map((field) => (
                <Text
                  key={field.label}
                  style={{
                    margin: "0 0 8px",
                    fontSize: "15px",
                    lineHeight: "22px",
                    color: INK,
                  }}
                >
                  <span style={{ color: MUTED }}>{field.label}: </span>
                  {field.value}
                </Text>
              ))}
            </Section>
          ))}

          {model.message ? (
            <Section style={{ marginTop: "32px" }}>
              <Text
                style={{
                  margin: "0 0 12px",
                  fontSize: "11px",
                  lineHeight: "16px",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: ACCENT,
                }}
              >
                {model.message.title}
              </Text>
              {/* `white-space: pre-wrap` preserves the visitor's own line
                  breaks without any markup being introduced. */}
              <Text
                style={{
                  margin: 0,
                  padding: "16px",
                  backgroundColor: BACKGROUND,
                  fontSize: "15px",
                  lineHeight: "24px",
                  whiteSpace: "pre-wrap",
                  color: INK,
                }}
              >
                {model.message.body}
              </Text>
            </Section>
          ) : null}

          {model.action ? (
            <Section style={{ marginTop: "32px" }}>
              <Link
                href={model.action.url}
                style={{
                  display: "inline-block",
                  padding: "12px 20px",
                  backgroundColor: INK,
                  color: SURFACE,
                  fontSize: "13px",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textDecoration: "none",
                }}
              >
                {model.action.label}
              </Link>
            </Section>
          ) : null}

          {model.footNote ? (
            <>
              <Hr
                style={{
                  margin: "32px 0 16px",
                  border: "none",
                  borderTop: `1px solid ${BORDER}`,
                }}
              />
              <Text
                style={{
                  margin: 0,
                  fontSize: "13px",
                  lineHeight: "20px",
                  color: MUTED,
                }}
              >
                {model.footNote}
              </Text>
            </>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
