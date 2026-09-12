import { z } from "zod";

export const INQUIRY_STATUSES = ["NEW", "CONTACTED", "DISCUSSION", "QUOTE_SENT", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
const optional = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const phone = optional(50).refine((v) => !v || !/[\u0000-\u001f\u007f]/.test(v), "Remove control characters.");

export const inquirySchema = z.object({
  submissionToken: z.string().uuid(),
  website: z.string().max(0),
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().email("Enter a valid email address.").max(254),
  phone,
  whatsapp: phone,
  company: optional(160),
  projectType: z.string().trim().min(1, "Enter a project type.").max(160),
  projectDate: z.string().trim().regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").transform((v) => v ? new Date(`${v}T00:00:00.000Z`) : null),
  location: optional(200), budgetLabel: optional(120),
  serviceSlug: z.string().trim().max(100).regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/).transform((v) => v || null),
  referralSource: optional(200),
  message: z.string().trim().min(10, "Please add a little more detail.").max(5000),
});

export const statusSchema = z.object({ id: z.string().uuid(), status: z.enum(INQUIRY_STATUSES) });
export const EMAIL_DELIVERY_TYPES = ["INQUIRY_ADMIN_NOTIFICATION", "INQUIRY_CUSTOMER_ACKNOWLEDGMENT"] as const;
export const retryEmailSchema = z.object({ inquiryId: z.string().uuid(), type: z.enum(EMAIL_DELIVERY_TYPES) });
export const noteSchema = z.object({ customerId: z.string().uuid(), body: z.string().trim().min(1).max(4000) });
export const customerSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254), phone, whatsapp: phone, company: optional(160),
});
export const anonymizeCustomerSchema = z.object({
  customerId: z.string().uuid(),
  confirmation: z.literal("ANONYMIZE"),
});
