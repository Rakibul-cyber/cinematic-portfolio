import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocument } from "@/components/public/legal-document";
import { englishPrivacy, isLegalDraft, legalMetadataDescription, legalMetadataTitle } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  if (isLegalDraft("privacy")) notFound();
  return buildPublicMetadata({
    title: legalMetadataTitle("privacy"),
    description: legalMetadataDescription("privacy"),
    path: "/privacy",
    indexable: !isLegalDraft("privacy"),
  });
}

export default function PrivacyPage() {
  if (isLegalDraft("privacy")) notFound();
  return <LegalDocument counterpartHref="/datenschutz" counterpartLabel="Deutsche Datenschutzhinweise" draft={isLegalDraft("privacy")} eyebrow="Privacy" language="en" sections={englishPrivacy} title="Privacy notice" />;
}
