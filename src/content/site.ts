type NavigationItem = {
  label: string;
  href: `#${string}`;
};

type VisualTone = "ink" | "stone" | "umber";

type FeaturedStudy = {
  title: string;
  discipline: string;
  note: string;
  visualLabel: string;
  tone: VisualTone;
  layout: "wide" | "portrait";
};

type ServicePreview = {
  number: string;
  title: string;
  description: string;
};

type SiteContent = {
  contentNotice: string;
  brand: {
    name: string;
    descriptor: string;
  };
  navigation: readonly NavigationItem[];
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    primaryAction: NavigationItem;
    context: readonly string[];
    visualLabel: string;
    scrollLabel: string;
  };
  featuredWork: {
    eyebrow: string;
    title: string;
    description: string;
    items: readonly FeaturedStudy[];
  };
  showreel: {
    eyebrow: string;
    title: string;
    description: string;
    unavailableLabel: string;
    visualLabel: string;
  };
  services: {
    eyebrow: string;
    title: string;
    description: string;
    items: readonly ServicePreview[];
  };
  studio: {
    eyebrow: string;
    statement: string;
    note: string;
  };
  contact: {
    eyebrow: string;
    title: string;
    description: string;
    actionLabel: string;
  };
  socialLinks: readonly { label: string; href: string }[];
  footer: {
    note: string;
  };
};

// Phase 1 placeholder copy. Replace from approved photographer content in a later phase.
export const siteContent: SiteContent = {
  contentNotice: "Phase 1 visual study — final portfolio content to come.",
  brand: {
    name: "Studio Name",
    descriptor: "Photography · Film",
  },
  navigation: [
    { label: "Work", href: "#work" },
    { label: "Services", href: "#services" },
    { label: "About", href: "#about" },
    { label: "Contact", href: "#contact" },
  ],
  hero: {
    eyebrow: "Independent visual practice",
    title: "Stories, framed in light and movement.",
    description:
      "A restrained foundation for photographs and films with atmosphere, honesty, and a lasting sense of place.",
    primaryAction: { label: "Explore the studies", href: "#work" },
    context: ["Portrait", "Editorial", "Motion"],
    visualLabel: "Abstract placeholder for the future hero artwork",
    scrollLabel: "Scroll to selected work",
  },
  featuredWork: {
    eyebrow: "Selected work",
    title: "Studies in atmosphere",
    description:
      "These neutral compositions reserve space for commissioned projects without presenting fictional client work.",
    items: [
      {
        title: "Light Study No. 01",
        discipline: "Portrait direction",
        note: "Visual placeholder",
        visualLabel: "Warm abstract placeholder for a portrait project",
        tone: "stone",
        layout: "wide",
      },
      {
        title: "Motion Study No. 02",
        discipline: "Film direction",
        note: "Visual placeholder",
        visualLabel: "Dark abstract placeholder for a film project",
        tone: "ink",
        layout: "portrait",
      },
      {
        title: "Form Study No. 03",
        discipline: "Commercial image",
        note: "Visual placeholder",
        visualLabel: "Earth-toned abstract placeholder for a commercial project",
        tone: "umber",
        layout: "portrait",
      },
    ],
  },
  showreel: {
    eyebrow: "In motion",
    title: "A future home for the showreel.",
    description:
      "The production-ready privacy player and final film belong to Phase 5. This panel establishes its scale and rhythm only.",
    unavailableLabel: "Showreel coming later",
    visualLabel: "Placeholder frame for the future privacy-conscious showreel",
  },
  services: {
    eyebrow: "Practice",
    title: "Still and moving image, shaped with intention.",
    description:
      "A concise service structure ready for the studio’s real offer and language.",
    items: [
      {
        number: "01",
        title: "Photography",
        description: "Portrait, editorial, and considered documentary imagery.",
      },
      {
        number: "02",
        title: "Film",
        description: "Short-form stories built around pace, feeling, and place.",
      },
      {
        number: "03",
        title: "Commercial",
        description: "Distinct visual narratives for thoughtful brands and teams.",
      },
      {
        number: "04",
        title: "Events",
        description: "Observant coverage that preserves atmosphere and detail.",
      },
    ],
  },
  studio: {
    eyebrow: "The studio",
    statement:
      "Quiet observation. Precise craft. Images that leave enough room to feel.",
    note:
      "This temporary statement will be replaced by the photographer’s approved biography and point of view.",
  },
  contact: {
    eyebrow: "Start a conversation",
    title: "Have a story in mind?",
    description:
      "The full inquiry workflow arrives in a later phase. For now, this is the intended invitation and visual endpoint.",
    actionLabel: "Contact section preview",
  },
  socialLinks: [],
  footer: {
    note: "A Phase 1 portfolio foundation.",
  },
};
