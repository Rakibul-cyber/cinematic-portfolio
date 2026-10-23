import type { Metadata } from "next";

import { LegalDocument } from "@/components/public/legal-document";
import { englishLegalNotice } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildPublicMetadata({
    title: "Legal notice – draft",
    description: "Draft legal notice for Munir Visuals; not approved for publication.",
    path: "/legal-notice",
  });
}

export default function LegalNoticePage() {
  return <LegalDocument counterpartHref="/impressum" counterpartLabel="Deutsches Impressum" eyebrow="Legal information" language="en" sections={englishLegalNotice} title="Legal notice" />;
}
