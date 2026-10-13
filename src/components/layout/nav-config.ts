import type { PermissionKey } from "@/server/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Zichtbaar zodra de gebruiker één van deze rechten heeft. */
  permissions?: PermissionKey[];
  /** Actief ook op onderliggende paden. */
  match?: string;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    title: "Werk",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/clients", label: "Klanten", icon: "Building2", permissions: ["clients:read"], match: "/clients" },
      { href: "/leads", label: "Leads", icon: "Target", permissions: ["clients:read"], match: "/leads" },
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
      { href: "/koppelingen", label: "Koppelingen", icon: "Link2", permissions: ["videos:write"], match: "/koppelingen" },
      { href: "/insights", label: "AI-inzichten", icon: "Sparkles", permissions: ["ai:read"], match: "/insights" },
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
      { href: "/financien", label: "Financiën", icon: "Landmark", permissions: ["finance:read"], match: "/financien" },
      { href: "/klantenbeheer", label: "Klantenbeheer", icon: "UserCog", permissions: ["clients:write"], match: "/klantenbeheer" },
      { href: "/editkosten", label: "Winst & editkosten", icon: "Euro", permissions: ["finance:read"], match: "/editkosten" },
      { href: "/settings/integrations", label: "Koppelingen", icon: "Plug", permissions: ["integrations:read"], match: "/settings/integrations" },
      { href: "/migratie", label: "Monday-migratie", icon: "Database", permissions: ["integrations:read"], match: "/migratie" },
      { href: "/settings", label: "Instellingen", icon: "Settings", permissions: ["settings:read", "users:read"], match: "/settings" },
    ],
  },
];
