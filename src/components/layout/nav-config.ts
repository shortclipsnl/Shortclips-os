import type { PermissionKey } from "@/server/auth/permissions";

/** Rollen zoals in de user_role-enum (zie src/db/schema/enums.ts). */
type UserRole = "owner" | "admin" | "project_coordinator" | "content_creator" | "videographer" | "editor" | "finance" | "client";

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
  /** Náást de eigenaar ook zichtbaar voor deze rollen (rolgebaseerd, geen e-mailuitzonderingen). */
  roles?: UserRole[];
};

export type NavGroup = {
  title: string;
  /** Accentkleur (CSS-variabele) voor de sectietitel, zodat het menu scanbaar is. */
  accent?: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    title: "Overzicht",
    accent: "var(--color-brand-600)",
    items: [
      { href: "/dashboard", label: "Vandaag", icon: "LayoutDashboard" },
      { href: "/kwaliteit", label: "Kwaliteit & Aandachtspunten", icon: "ShieldCheck", match: "/kwaliteit" },
    ],
  },
  {
    // Alles rondom de productie: klant, planning, script, opname, edit, video's.
    title: "Werk",
    accent: "var(--color-violet)",
    items: [
      { href: "/clients", label: "Onze klanten", icon: "Building2", permissions: ["clients:read"], match: "/clients" },
      { href: "/planning", label: "Productieplanning", icon: "CalendarRange", permissions: ["productions:read", "videos:read"], match: "/planning" },
      { href: "/calendar", label: "Contentplanning", icon: "CalendarDays", permissions: ["calendar:read"], match: "/calendar" },
      { href: "/scripting", label: "Scripting", icon: "ScrollText", permissions: ["scripts:read"], match: "/scripting" },
      { href: "/productions", label: "Opnameplanning", icon: "Camera", permissions: ["productions:read"], match: "/productions" },
      { href: "/videos", label: "Editing", icon: "Scissors", permissions: ["videos:read"], match: "/videos" },
    ],
  },
  {
    title: "Resultaten",
    accent: "var(--color-good)",
    items: [
      { href: "/analytics", label: "Resultatenoverzicht", icon: "TrendingUp", permissions: ["analytics:read"], match: "/analytics" },
      { href: "/video-intelligence", label: "Video Intelligence", icon: "Sparkles", permissions: ["video_intelligence:read"], match: "/video-intelligence" },
    ],
  },
  {
    title: "Team",
    accent: "var(--color-warn)",
    items: [
      { href: "/tasks", label: "Taken", icon: "CircleCheck", permissions: ["tasks:read"], match: "/tasks" },
      { href: "/team", label: "Team", icon: "Users", permissions: ["team:read", "editors:read"], match: "/team" },
      { href: "/capaciteit", label: "Teamcapaciteit", icon: "Gauge", permissions: ["team:read", "editors:read"], match: "/capaciteit" },
      { href: "/verlof", label: "Vakantie", icon: "Palmtree", match: "/verlof" },
      { href: "/meetings", label: "Teammeetings", icon: "Presentation", match: "/meetings" },
    ],
  },
  {
    title: "AI Tools",
    accent: "var(--color-info)",
    items: [
      { href: "/ai/assistent", label: "AI Assistent", icon: "Bot", permissions: ["ai:read"], match: "/ai/assistent" },
      { href: "/ai/caption", label: "Caption Maker", icon: "Sparkles", permissions: ["ai:read"], match: "/ai/caption" },
      { href: "/ai/briefing", label: "Editor Briefing", icon: "ClipboardList", permissions: ["ai:read"], match: "/ai/briefing" },
      { href: "/ai/bericht", label: "Klantbericht", icon: "MessagesSquare", permissions: ["ai:read"], match: "/ai/bericht" },
      { href: "/ai/bedrijfsonderzoek", label: "Bedrijfsonderzoek", icon: "Search", permissions: ["ai:read"], match: "/ai/bedrijfsonderzoek" },
      { href: "/ai/geschiedenis", label: "AI-geschiedenis", icon: "History", permissions: ["ai:read"], match: "/ai/geschiedenis" },
      { href: "/ai/kennisbank", label: "AI-kennisbank", icon: "BookOpen", permissions: ["ai:read"], match: "/ai/kennisbank" },
    ],
  },
  {
    // Beheer, inclusief de uitsluitend voor de eigenaar zichtbare onderdelen.
    title: "Beheer",
    accent: "var(--color-ink-muted)",
    items: [
      { href: "/leads", label: "Leads", icon: "Target", ownerOnly: true, match: "/leads" },
      { href: "/financien", label: "Financiën", icon: "Landmark", ownerOnly: true, match: "/financien" },
      { href: "/editkosten", label: "Winst & editkosten", icon: "Euro", ownerOnly: true, match: "/editkosten" },
      { href: "/klantenbeheer", label: "Klantenbeheer", icon: "UserCog", roles: ["project_coordinator"], match: "/klantenbeheer" },
      { href: "/koppelingen", label: "Koppeling controleren", icon: "Link2", ownerOnly: true, match: "/koppelingen" },
      { href: "/settings/agendas", label: "Agenda's", icon: "CalendarRange", ownerOnly: true, match: "/settings/agendas" },
      { href: "/settings/integrations", label: "Koppelingen", icon: "Plug", ownerOnly: true, match: "/settings/integrations" },
      { href: "/migratie", label: "Monday-migratie", icon: "Database", ownerOnly: true, match: "/migratie" },
      { href: "/settings", label: "Instellingen", icon: "Settings", permissions: ["settings:read", "users:read"], match: "/settings" },
    ],
  },
];
