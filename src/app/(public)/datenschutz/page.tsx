import type { Metadata } from "next";

import { LegalDocument } from "@/components/public/legal-document";
import { germanPrivacy } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildPublicMetadata({
    title: "Datenschutz – Entwurf",
    description: "Entwurf der Datenschutzhinweise von Munir Visuals, nicht zur Veröffentlichung freigegeben.",
    path: "/datenschutz",
  });
}

export default function DatenschutzPage() {
  return <LegalDocument counterpartHref="/privacy" counterpartLabel="English privacy notice" eyebrow="Datenschutz" language="de" sections={germanPrivacy} title="Datenschutzhinweise" />;
}
