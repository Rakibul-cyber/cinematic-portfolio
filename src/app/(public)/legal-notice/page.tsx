import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocument } from "@/components/public/legal-document";
import { englishLegalNotice, isLegalDraft, legalMetadataDescription, legalMetadataTitle } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  if (isLegalDraft("legalNotice")) notFound();
  return buildPublicMetadata({
    title: legalMetadataTitle("legalNotice"),
    description: legalMetadataDescription("legalNotice"),
    path: "/legal-notice",
    indexable: !isLegalDraft("legalNotice"),
  });
}

export default function LegalNoticePage() {
  if (isLegalDraft("legalNotice")) notFound();
  return <LegalDocument counterpartHref="/impressum" counterpartLabel="Deutsches Impressum" draft={isLegalDraft("legalNotice")} eyebrow="Legal information" language="en" sections={englishLegalNotice} title="Legal notice" />;
}
