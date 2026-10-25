import type { Metadata } from "next";

import { LegalDocument } from "@/components/public/legal-document";
import { englishLegalNotice, isLegalDraft, legalMetadataTitle } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildPublicMetadata({
    title: legalMetadataTitle("legalNotice"),
    description: "Draft legal notice for Munir Visuals; not approved for publication.",
    path: "/legal-notice",
    indexable: !isLegalDraft("legalNotice"),
  });
}

export default function LegalNoticePage() {
  return <LegalDocument counterpartHref="/impressum" counterpartLabel="Deutsches Impressum" draft={isLegalDraft("legalNotice")} eyebrow="Legal information" language="en" sections={englishLegalNotice} title="Legal notice" />;
}
