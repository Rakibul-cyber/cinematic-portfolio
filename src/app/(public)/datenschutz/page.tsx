import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocument } from "@/components/public/legal-document";
import { germanPrivacy, isLegalDraft, legalMetadataDescription, legalMetadataTitle } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  if (isLegalDraft("datenschutz")) notFound();
  return buildPublicMetadata({
    title: legalMetadataTitle("datenschutz"),
    description: legalMetadataDescription("datenschutz"),
    path: "/datenschutz",
    indexable: !isLegalDraft("datenschutz"),
  });
}

export default function DatenschutzPage() {
  if (isLegalDraft("datenschutz")) notFound();
  return <LegalDocument counterpartHref="/privacy" counterpartLabel="English privacy notice" draft={isLegalDraft("datenschutz")} eyebrow="Datenschutz" language="de" sections={germanPrivacy} title="Datenschutzhinweise" />;
}
