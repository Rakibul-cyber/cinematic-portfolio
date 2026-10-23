import type { Metadata } from "next";

import { LegalDocument } from "@/components/public/legal-document";
import { englishPrivacy } from "@/content/legal";
import { buildPublicMetadata } from "@/server/public/metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildPublicMetadata({
    title: "Privacy notice – draft",
    description: "Draft privacy notice for Munir Visuals; not approved for publication.",
    path: "/privacy",
  });
}

export default function PrivacyPage() {
  return <LegalDocument counterpartHref="/datenschutz" counterpartLabel="Deutsche Datenschutzhinweise" eyebrow="Privacy" language="en" sections={englishPrivacy} title="Privacy notice" />;
}
