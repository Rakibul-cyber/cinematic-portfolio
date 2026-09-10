import { sanitizeSubject } from "@/lib/email/address";

/**
 * Email content model.
 *
 * Both transactional emails are described as data first and rendered second.
 * Keeping the wording, field selection, ordering, and subject construction in a
 * pure module means the decisions that matter can be unit-tested without React,
 * a database, or a provider key — and the same model produces both the HTML and
 * the plain-text alternative, so the two can never drift apart.
 *
 * Everything here is built from the Inquiry snapshot. Nothing reads the mutable
 * Customer record, so an email always reflects what the visitor actually sent.
 */

export type EmailField = { label: string; value: string };
export type EmailGroup = { title: string; fields: EmailField[] };

export type EmailModel = {
  subject: string;
  /** Inbox preview line. Never contains the message body. */
  preview: string;
  heading: string;
  intro: string[];
  groups: EmailGroup[];
  message?: { title: string; body: string };
  action?: { label: string; url: string };
  footNote?: string;
};

/** The Inquiry snapshot fields both emails are built from. */
export type InquirySnapshot = {
  id: string;
  createdAt: Date;
  nameSnapshot: string;
  emailSnapshot: string;
  phoneSnapshot: string | null;
  whatsappSnapshot: string | null;
  companySnapshot: string | null;
  serviceNameSnapshot: string | null;
  projectType: string;
  projectDate: Date | null;
  location: string | null;
  budgetLabel: string | null;
  referralSource: string | null;
  message: string;
};

/**
 * Formats the stored preferred date.
 *
 * `projectDate` is a PostgreSQL DATE, which Prisma returns as midnight UTC.
 * Formatting in UTC keeps the calendar date the visitor picked; a local time
 * zone would shift it a day backwards west of Greenwich.
 */
export function formatProjectDate(value: Date): string {
  return value.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Formats a submission instant.
 *
 * Rendered in UTC and labelled as such: an email has no reliable reader time
 * zone, and an unlabelled time invites misreading.
 */
export function formatSubmittedAt(value: Date): string {
  const formatted = value.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });

  return `${formatted} UTC`;
}

/** Drops fields the visitor left empty rather than printing blank rows. */
function fields(entries: [string, string | null | undefined][]): EmailField[] {
  return entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
    .map(([label, value]) => ({ label, value: value.trim() }));
}

/**
 * Studio notification.
 *
 * Reports the submission as received, with an optional link into the
 * authenticated admin area. The subject carries only the project type, which is
 * bounded and sanitized; the message body never reaches the subject or preview.
 */
export function buildAdminNotification(
  inquiry: InquirySnapshot,
  options: { adminUrl?: string | null } = {},
): EmailModel {
  const contact = fields([
    ["Name", inquiry.nameSnapshot],
    ["Email", inquiry.emailSnapshot],
    ["Phone", inquiry.phoneSnapshot],
    ["WhatsApp", inquiry.whatsappSnapshot],
    ["Company", inquiry.companySnapshot],
  ]);

  const project = fields([
    ["Project type", inquiry.projectType],
    ["Service", inquiry.serviceNameSnapshot],
    [
      "Preferred date",
      inquiry.projectDate ? formatProjectDate(inquiry.projectDate) : null,
    ],
    ["Location", inquiry.location],
    ["Budget", inquiry.budgetLabel],
    ["Heard about the studio", inquiry.referralSource],
    ["Received", formatSubmittedAt(inquiry.createdAt)],
  ]);

  return {
    subject: sanitizeSubject(`New inquiry — ${inquiry.projectType}`),
    preview: sanitizeSubject(
      `${inquiry.nameSnapshot} · ${inquiry.projectType}`,
    ),
    heading: "New inquiry received",
    intro: [
      "Someone has sent an inquiry through the website. Their submission is below, exactly as it was received.",
    ],
    groups: [
      { title: "Contact", fields: contact },
      { title: "Project", fields: project },
    ].filter((group) => group.fields.length > 0),
    message: { title: "Message", body: inquiry.message },
    ...(options.adminUrl
      ? { action: { label: "View inquiry in admin", url: options.adminUrl } }
      : {}),
    footNote: "Replying to this email replies directly to the sender.",
  };
}

/**
 * Customer acknowledgment.
 *
 * Confirms receipt and repeats back a short summary so the visitor can see what
 * arrived. It deliberately promises nothing about response times, next steps, or
 * onward notifications: no such commitment is configured anywhere in the system,
 * and inventing one here would be a promise the studio never made.
 */
export function buildCustomerAcknowledgment(
  inquiry: InquirySnapshot,
  options: { studioName: string },
): EmailModel {
  const summary = fields([
    ["Project type", inquiry.projectType],
    ["Service", inquiry.serviceNameSnapshot],
    [
      "Preferred date",
      inquiry.projectDate ? formatProjectDate(inquiry.projectDate) : null,
    ],
    ["Location", inquiry.location],
    ["Sent", formatSubmittedAt(inquiry.createdAt)],
  ]);

  return {
    subject: sanitizeSubject("We received your inquiry"),
    preview: sanitizeSubject(
      `${options.studioName} has received your inquiry.`,
    ),
    heading: "Thank you for getting in touch",
    intro: [
      `Hello ${inquiry.nameSnapshot.trim()},`,
      `Your inquiry has reached ${options.studioName} and will be reviewed. There is nothing further you need to do.`,
    ],
    groups: summary.length
      ? [{ title: "What you sent", fields: summary }]
      : [],
    message: { title: "Your message", body: inquiry.message },
    footNote: "If any detail above looks wrong, simply reply to this email.",
  };
}

/**
 * Plain-text alternative.
 *
 * Built from the same model as the HTML, so the message never depends on CSS to
 * be understood and a text-only client sees the same content in the same order.
 */
export function toPlainText(model: EmailModel): string {
  const blocks: string[] = [model.heading, ...model.intro];

  for (const group of model.groups) {
    const rows = group.fields.map((field) => `${field.label}: ${field.value}`);
    blocks.push([group.title.toUpperCase(), ...rows].join("\n"));
  }

  if (model.message) {
    blocks.push(
      [model.message.title.toUpperCase(), model.message.body].join("\n"),
    );
  }

  if (model.action) blocks.push(`${model.action.label}: ${model.action.url}`);
  if (model.footNote) blocks.push(model.footNote);

  return `${blocks.join("\n\n")}\n`;
}
