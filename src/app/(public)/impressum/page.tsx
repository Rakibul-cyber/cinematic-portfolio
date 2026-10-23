import type { Metadata } from "next";

import { LegalDocument } from "@/components/public/legal-document";
import { germanLegalNotice } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildPublicMetadata({
    title: "Impressum – Entwurf",
    description: "Entwurf des Impressums von Munir Visuals, nicht zur Veröffentlichung freigegeben.",
    path: "/impressum",
  });
}

export default function ImpressumPage() {
  return <LegalDocument counterpartHref="/legal-notice" counterpartLabel="English legal notice" eyebrow="Rechtliche Informationen" language="de" sections={germanLegalNotice} title="Impressum" />;
}
