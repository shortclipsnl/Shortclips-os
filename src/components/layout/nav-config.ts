import type { PermissionKey } from "@/server/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Zichtbaar zodra de gebruiker één van deze rechten heeft. */
  permissions?: PermissionKey[];
  /** Actief ook op onderliggende paden. */
  match?: string;
  /** Alleen zichtbaar voor de eigenaar (Janno). */
  ownerOnly?: boolean;
  /** Náást de eigenaar ook zichtbaar voor deze e-mailadressen (lowercase). */
  allowEmails?: string[];
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    title: "Werk",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/clients", label: "Onze klanten", icon: "Building2", permissions: ["clients:read"], match: "/clients" },
      { href: "/leads", label: "Leads", icon: "Target", ownerOnly: true, match: "/leads" },
      { href: "/videos", label: "Editing Dashboard", icon: "Clapperboard", permissions: ["videos:read"], match: "/videos" },
      { href: "/editing", label: "Editors", icon: "Scissors", permissions: ["videos:read"], match: "/editing" },
      { href: "/productions", label: "Opnameplanning", icon: "Camera", permissions: ["productions:read"], match: "/productions" },
      { href: "/scripting", label: "Scripting", icon: "ScrollText", permissions: ["scripts:read"], match: "/scripting" },
      { href: "/calendar", label: "Contentplanning", icon: "CalendarDays", permissions: ["calendar:read"], match: "/calendar" },
      { href: "/tasks", label: "Taken", icon: "CircleCheck", permissions: ["tasks:read"], match: "/tasks" },
    ],
  },
  {
    title: "Inzicht",
    items: [
      { href: "/analytics", label: "Resultaten", icon: "TrendingUp", permissions: ["analytics:read"], match: "/analytics" },
      { href: "/team", label: "Team", icon: "Users", permissions: ["team:read", "editors:read"], match: "/team" },
      { href: "/verlof", label: "Vakantie", icon: "Palmtree", match: "/verlof" },
      { href: "/meetings", label: "Teammeetings", icon: "Presentation", match: "/meetings" },
    ],
  },
  {
    title: "AI Tools",
    items: [
      { href: "/ai/caption", label: "Caption Maker", icon: "Sparkles", permissions: ["ai:read"], match: "/ai/caption" },
      { href: "/ai/briefing", label: "Editor Briefing", icon: "ClipboardList", permissions: ["ai:read"], match: "/ai/briefing" },
      { href: "/ai/bericht", label: "Klantbericht", icon: "MessagesSquare", permissions: ["ai:read"], match: "/ai/bericht" },
      { href: "/ai/bedrijfsonderzoek", label: "Bedrijfsonderzoek", icon: "Search", permissions: ["ai:read"], match: "/ai/bedrijfsonderzoek" },
      { href: "/ai/geschiedenis", label: "AI-geschiedenis", icon: "History", permissions: ["ai:read"], match: "/ai/geschiedenis" },
      { href: "/ai/kennisbank", label: "AI-kennisbank", icon: "BookOpen", permissions: ["ai:read"], match: "/ai/kennisbank" },
    ],
  },
  {
    title: "Beheer",
    items: [
      { href: "/financien", label: "Financiën", icon: "Landmark", ownerOnly: true, match: "/financien" },
      { href: "/klantenbeheer", label: "Klantenbeheer", icon: "UserCog", allowEmails: ["milou@shortclips.nl"], match: "/klantenbeheer" },
      { href: "/editkosten", label: "Winst & editkosten", icon: "Euro", ownerOnly: true, match: "/editkosten" },
      { href: "/koppelingen", label: "Koppeling controleren", icon: "Link2", ownerOnly: true, match: "/koppelingen" },
      { href: "/settings/integrations", label: "Koppelingen", icon: "Plug", ownerOnly: true, match: "/settings/integrations" },
      { href: "/migratie", label: "Monday-migratie", icon: "Database", ownerOnly: true, match: "/migratie" },
      { href: "/settings", label: "Instellingen", icon: "Settings", permissions: ["settings:read", "users:read"], match: "/settings" },
    ],
  },
];
