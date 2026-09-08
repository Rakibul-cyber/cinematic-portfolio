"use server";
import { inquirySchema } from "@/lib/validation/crm";
import { createInquiry, InvalidServiceError } from "@/server/crm/service";

export type InquiryFormState = { success: boolean; message?: string; errors?: Record<string, string[]> };
export async function submitInquiry(_: InquiryFormState, form: FormData): Promise<InquiryFormState> {
  const parsed = inquirySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { success: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten().fieldErrors };
  try {
    await createInquiry(parsed.data);
    return { success: true, message: "Thank you. Your inquiry has been received." };
  } catch (error) {
    if (error instanceof InvalidServiceError) return { success: false, message: error.message, errors: { serviceSlug: [error.message] } };
    return { success: false, message: "We could not receive your inquiry. Please try again." };
  }
}
