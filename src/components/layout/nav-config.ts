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
  /** Uitsluitend voor editors — ook de eigenaar/het team ziet dit niet. */
  editorsOnly?: boolean;
  /** Externe/zelfstandige pagina: open als gewone link in een nieuw tabblad
   *  (bijv. het schermvullende vermogensdashboard, buiten de portaalschil). */
  external?: boolean;
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
      { href: "/doelen", label: "Doelen", icon: "Target", match: "/doelen" },
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
      { href: "/scriptcontrole", label: "Scriptcontrole", icon: "ClipboardCheck", permissions: ["scripts:write"], match: "/scriptcontrole" },
      { href: "/productions", label: "Opnameplanning", icon: "Camera", permissions: ["productions:read"], match: "/productions" },
      { href: "/videos", label: "Editing", icon: "Scissors", permissions: ["videos:read"], match: "/videos" },
      // Persoonlijke klantenbibliotheek voor editors (eigen klanten + Editing Guide).
      { href: "/mijn-klanten", label: "Mijn klanten", icon: "BookOpen", match: "/mijn-klanten", editorsOnly: true },
      { href: "/showcase", label: "Showcase", icon: "Trophy", permissions: ["videos:read"], match: "/showcase", editorsOnly: true },
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
      // Interne kennisbank (vervanger van Skool): lezen voor iedereen intern,
      // beheren alleen voor de eigenaar (afgedwongen op de server).
      { href: "/kennisbank", label: "Shortclips Kennisbank", icon: "GraduationCap", match: "/kennisbank" },
    ],
  },
  {
    title: "AI Tools",
    accent: "var(--color-info)",
    items: [
      { href: "/ai/mentor", label: "AI Mentor", icon: "Brain", ownerOnly: true, match: "/ai/mentor" },
      { href: "/ai/scriptgenerator", label: "Scriptgenerator", icon: "PenLine", permissions: ["ai:read"], match: "/ai/scriptgenerator" },
      { href: "/ai/caption", label: "Caption Maker", icon: "Sparkles", permissions: ["ai:read"], match: "/ai/caption" },
      { href: "/ai/briefing", label: "Editor Briefing", icon: "ClipboardList", permissions: ["ai:read"], match: "/ai/briefing" },
      { href: "/ai/bericht", label: "Klantbericht", icon: "MessagesSquare", permissions: ["ai:read"], match: "/ai/bericht" },
      { href: "/ai/bedrijfsonderzoek", label: "AI Sales Research", icon: "Search", permissions: ["ai:read"], match: "/ai/bedrijfsonderzoek" },
      { href: "/ai/geschiedenis", label: "AI-geschiedenis", icon: "History", permissions: ["ai:read"], match: "/ai/geschiedenis" },
      { href: "/ai/kennisbank", label: "AI-kennisbank", icon: "BookOpen", permissions: ["ai:read"], match: "/ai/kennisbank" },
    ],
  },
  {
    // Alles rondom geld: uitsluitend voor de eigenaar (Janno). Leads, financiën,
    // kosten, marge/winst en het vermogensdashboard bij elkaar.
    title: "Financieel",
    accent: "var(--color-good)",
    items: [
      { href: "/leads", label: "Leads", icon: "Target", ownerOnly: true, match: "/leads" },
      { href: "/financien", label: "Financiën", icon: "Landmark", ownerOnly: true, match: "/financien" },
      { href: "/kosten", label: "Kostenmonitor", icon: "ReceiptEuro", ownerOnly: true, match: "/kosten" },
      { href: "/editkosten", label: "Winst & editkosten", icon: "Euro", ownerOnly: true, match: "/editkosten" },
      { href: "/winstgevendheid", label: "Winstgevendheid", icon: "TrendingUp", ownerOnly: true, match: "/winstgevendheid" },
      { href: "/dashboard/vermogen", label: "Vermogen", icon: "Wallet", ownerOnly: true, external: true },
    ],
  },
  {
    // Beheer: koppelingen, agenda's, klantenbeheer en instellingen.
    title: "Beheer",
    accent: "var(--color-ink-muted)",
    items: [
      { href: "/klantenbeheer", label: "Klantenbeheer", icon: "UserCog", roles: ["project_coordinator"], match: "/klantenbeheer" },
      { href: "/noodprocedure", label: "Noodprocedure", icon: "LifeBuoy", roles: ["project_coordinator"], match: "/noodprocedure" },
      { href: "/koppelingen", label: "Koppeling controleren", icon: "Link2", ownerOnly: true, match: "/koppelingen" },
      { href: "/settings/agendas", label: "Agenda's", icon: "CalendarRange", ownerOnly: true, match: "/settings/agendas" },
      { href: "/settings/integrations", label: "Koppelingen", icon: "Plug", ownerOnly: true, match: "/settings/integrations" },
      { href: "/settings/portaal", label: "Klantportaal-instellingen", icon: "SlidersHorizontal", permissions: ["scripts:write"], match: "/settings/portaal" },
      { href: "/settings", label: "Instellingen", icon: "Settings", permissions: ["settings:read", "users:read"], match: "/settings" },
    ],
  },
];
