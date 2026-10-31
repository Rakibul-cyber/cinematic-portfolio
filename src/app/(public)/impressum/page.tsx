import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocument } from "@/components/public/legal-document";
import { germanLegalNotice, isLegalDraft, legalMetadataTitle } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  if (isLegalDraft("impressum")) notFound();
  return buildPublicMetadata({
    title: legalMetadataTitle("impressum"),
    description: "Entwurf des Impressums von Munir Visuals, nicht zur Veröffentlichung freigegeben.",
    path: "/impressum",
    indexable: !isLegalDraft("impressum"),
  });
}

export default function ImpressumPage() {
  if (isLegalDraft("impressum")) notFound();
  return <LegalDocument counterpartHref="/legal-notice" counterpartLabel="English legal notice" draft={isLegalDraft("impressum")} eyebrow="Rechtliche Informationen" language="de" sections={germanLegalNotice} title="Impressum" />;
}
