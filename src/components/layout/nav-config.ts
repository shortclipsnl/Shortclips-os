import type { PermissionKey } from "@/server/auth/permissions";

/** Rollen zoals in de user_role-enum (zie src/db/schema/enums.ts). */
type UserRole = "owner" | "admin" | "operational_manager" | "project_coordinator" | "content_creator" | "videographer" | "editor" | "finance" | "client";

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
  /** Zichtbaar voor iedereen die klanten mag beheren (eigenaar, projectcoördinatoren
   *  én het vaste kernteam). Gelijk aan de toegang van de klantenbeheer-pagina. */
  manageClients?: boolean;
  /** Zichtbaar voor de eigenaar + aangewezen teamleden van de offertemodule. */
  quotesAccess?: boolean;
  /** Zichtbaar voor de eigenaar + Milou en Jiska (leadopvolging en omzetten). */
  leadsAccess?: boolean;
  /** Zichtbaar voor de eigenaar + de operationeel beheerder (Milou). Voor de
   *  voorheen eigenaar-only operationele surfaces (koppelingen, portaal-instellingen). */
  manageOperations?: boolean;
  /** Uitsluitend voor editors — ook de eigenaar/het team ziet dit niet. */
  editorsOnly?: boolean;
  /** Alleen voor de eigenaar en de medewerkers met klantverantwoordelijkheid (Milou, Jiska, Rutger). */
  verantwoordelijkhedenAccess?: boolean;
  /** Afwijkend label in het editorportaal (het interne team houdt `label`). */
  editorLabel?: string;
  /** Externe/zelfstandige pagina: open als gewone link in een nieuw tabblad
   *  (bijv. het schermvullende vermogensdashboard, buiten de portaalschil). */
  external?: boolean;
  /** Geen eigen menu-item: verschijnt als tabblad bovenaan de pagina van het
   *  menu-item met deze href (bijv. Video Intelligence onder Resultaten). */
  section?: string;
};

export type NavGroup = {
  title: string;
  /** Accentkleur (CSS-variabele) voor de sectietitel, zodat het menu scanbaar is. */
  accent?: string;
  items: NavItem[];
};

/**
 * Indeling (nov 2026): het menu volgt het werkproces van boven naar beneden en
 * het team ziet alleen wat het dagelijks gebruikt. Pagina's die bij elkaar
 * horen staan niet los in het menu maar als tabbladen bovenaan elkaars pagina
 * (zie `section` en SectionTabs). Zichtbaarheid per item is ongewijzigd: de
 * rechten-, eigenaar- en rolvlaggen hieronder bepalen nog steeds wie wat ziet.
 */
export const NAVIGATION: NavGroup[] = [
  {
    title: "Vandaag",
    accent: "var(--color-brand-600)",
    items: [
      { href: "/dashboard", label: "Vandaag", icon: "LayoutDashboard" },
      { href: "/tasks", label: "Taken", icon: "CircleCheck", permissions: ["tasks:read"], match: "/tasks" },
      { href: "/kwaliteit", label: "Aandachtspunten", icon: "ShieldCheck", match: "/kwaliteit" },
      // Persoonlijk: eigen verantwoordelijkheden, bevoegdheden en wanneer Jarno erbij moet.
      { href: "/verantwoordelijkheden", label: "Mijn verantwoordelijkheden", icon: "ListChecks", match: "/verantwoordelijkheden", verantwoordelijkhedenAccess: true },
    ],
  },
  {
    // De productie in procesvolgorde: klant → planning → script → content →
    // opname → edit → resultaat.
    title: "Productie",
    accent: "var(--color-violet)",
    items: [
      { href: "/clients", label: "Klanten", icon: "Building2", permissions: ["clients:read"], match: "/clients" },
      { href: "/planning", label: "Weekplanning", icon: "CalendarRange", permissions: ["productions:read", "videos:read"], match: "/planning" },
      { href: "/scripting", label: "Scripting", icon: "ScrollText", permissions: ["scripts:read"], match: "/scripting" },
      { href: "/calendar", label: "Contentplanning", icon: "CalendarDays", permissions: ["calendar:read"], match: "/calendar" },
      { href: "/productions", label: "Opnames", icon: "Camera", permissions: ["productions:read"], match: "/productions" },
      { href: "/draaiboek", label: "Draaiboek", icon: "ClipboardList", permissions: ["productions:read"], match: "/draaiboek" },
      { href: "/videos", label: "Editing", editorLabel: "Editing Planning", icon: "Scissors", permissions: ["videos:read"], match: "/videos" },
      // Wie zit vol, wie heeft ruimte en welke opnames komen eraan (niet voor editors).
      { href: "/capaciteit", label: "Capaciteit", icon: "Gauge", permissions: ["productions:read", "team:read"], match: "/capaciteit" },
      // Persoonlijke klantenbibliotheek voor editors (eigen klanten + Editing Guide).
      { href: "/mijn-klanten", label: "Mijn klanten", icon: "BookOpen", match: "/mijn-klanten", editorsOnly: true },
      { href: "/showcase", label: "Showcase", icon: "Trophy", permissions: ["videos:read"], match: "/showcase", editorsOnly: true },
      { href: "/analytics", label: "Resultaten", icon: "TrendingUp", permissions: ["analytics:read"], match: "/analytics" },
      // Contentgeheugen: wat per klant aantoonbaar werkt (formats, hooks, CTA's, video's).
      { href: "/contentgeheugen", label: "Contentgeheugen", icon: "BrainCircuit", permissions: ["analytics:read"], match: "/contentgeheugen" },
      { href: "/analytics/maandrapportages", label: "Maandrapportages", icon: "FileText", permissions: ["reports:read", "reports:team_read"], match: "/analytics/maandrapportages" },
      { href: "/video-intelligence", label: "Video Intelligence", icon: "Sparkles", permissions: ["video_intelligence:read"], match: "/video-intelligence", section: "/analytics" },
    ],
  },
  {
    title: "Tools",
    accent: "var(--color-info)",
    items: [
      { href: "/ai/scriptgenerator", label: "Scriptgenerator", icon: "PenLine", permissions: ["ai:read"], match: "/ai/scriptgenerator" },
      { href: "/ai/caption", label: "Caption Maker", icon: "Sparkles", permissions: ["ai:read"], match: "/ai/caption" },
      { href: "/ai/bericht", label: "Klantbericht", icon: "MessagesSquare", permissions: ["ai:read"], match: "/ai/bericht" },
      { href: "/ai/content-research", label: "Content Research", icon: "Lightbulb", permissions: ["content_research:read"], match: "/ai/content-research" },
      // Editor Briefing maak je centraal vanaf de Editing-pagina.
      { href: "/ai-editor", label: "AI Editor", icon: "Clapperboard", permissions: ["ai_editor:read"], match: "/ai-editor" },
      { href: "/ai/geschiedenis", label: "AI-geschiedenis", icon: "History", permissions: ["ai:history_read"], match: "/ai/geschiedenis" },
      // Voor het team pas zichtbaar zodra de R2-opslag is ingesteld (zie layout).
    ],
  },
  {
    title: "Team",
    accent: "var(--color-warn)",
    items: [
      { href: "/team", label: "Teamoverzicht", icon: "Users", permissions: ["team:read", "editors:read"], match: "/team" },
      { href: "/doelen", label: "Doelen", icon: "Target", match: "/doelen", section: "/team" },
      { href: "/verlof", label: "Vakantie", icon: "Palmtree", match: "/verlof" },
      { href: "/meetings", label: "Teammeetings", icon: "Presentation", match: "/meetings" },
      // Interne kennisbank (vervanger van Skool): lezen voor iedereen intern,
      // beheren alleen voor de eigenaar (afgedwongen op de server).
      { href: "/kennisbank", label: "Kennisbank", icon: "GraduationCap", match: "/kennisbank" },
      { href: "/beslissingshulp", label: "Beslissingshulp", icon: "Compass", match: "/beslissingshulp", section: "/kennisbank" },
      { href: "/noodprocedure", label: "Noodprocedure", icon: "LifeBuoy", manageClients: true, match: "/noodprocedure", section: "/kennisbank" },
      { href: "/ai/kennisbank", label: "AI-kennisbank", icon: "BookOpen", permissions: ["ai:read"], match: "/ai/kennisbank", section: "/kennisbank" },
    ],
  },
  {
    title: "Sales",
    accent: "var(--color-lime)",
    items: [
      { href: "/leads", label: "Leads", icon: "Target", leadsAccess: true, match: "/leads" },
      { href: "/offertes", label: "Offertes", icon: "FileSignature", quotesAccess: true, match: "/offertes" },
      // Interne prijslijst 2027: fase 1 alleen de eigenaar. Uitrol naar het team pas na akkoord van Jarno.
      { href: "/prijslijst", label: "Interne prijslijst 2027", icon: "Tags", ownerOnly: true, match: "/prijslijst" },
      { href: "/ai/bedrijfsonderzoek", label: "Sales Research", icon: "Search", permissions: ["ai:sales_research"], match: "/ai/bedrijfsonderzoek" },
    ],
  },
  {
    // Uitsluitend voor de eigenaar.
    title: "Financieel",
    accent: "var(--color-good)",
    items: [
      { href: "/financien", label: "Financiën", icon: "Landmark", ownerOnly: true, match: "/financien" },
      { href: "/kosten", label: "Kosten", icon: "ReceiptEuro", ownerOnly: true, match: "/kosten" },
      { href: "/contracten", label: "Contracten & Verlengingen", icon: "CalendarClock", ownerOnly: true, match: "/contracten" },
      { href: "/winstgevendheid", label: "Winstgevendheid", icon: "TrendingUp", ownerOnly: true, match: "/winstgevendheid" },
      { href: "/editkosten", label: "Winst & editkosten", icon: "Euro", ownerOnly: true, match: "/editkosten", section: "/winstgevendheid" },
      { href: "/dashboard/vermogen", label: "Vermogen", icon: "Wallet", ownerOnly: true, match: "/dashboard/vermogen" },
    ],
  },
  {
    // Klantbeheer (klanten, accounts, portaal, koppelingen) en systeembeheer.
    // Milou (operationeel beheerder) ziet hier haar onderdelen, de rest blijft
    // bij de eigenaar.
    title: "Beheer",
    accent: "var(--color-ink-faint)",
    items: [
      { href: "/klantenbeheer", label: "Klantbeheer", icon: "UserCog", manageOperations: true, match: "/klantenbeheer" },
      { href: "/settings/portaal", label: "Klantportaal", icon: "SlidersHorizontal", manageOperations: true, match: "/settings/portaal" },
      { href: "/settings/integrations", label: "Koppelingen", icon: "Plug", manageOperations: true, match: "/settings/integrations" },
      { href: "/settings/agendas", label: "Agenda's", icon: "CalendarRange", ownerOnly: true, match: "/settings/agendas" },
      { href: "/settings", label: "Instellingen", icon: "Settings", permissions: ["settings:read", "users:read"], match: "/settings" },
    ],
  },
];

/**
 * Het menu-item dat bij een pad hoort: de langste href die past. Zo licht bij
 * /settings/portaal alleen "Klantportaal" op en niet ook "Instellingen".
 */
export function matchNavHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const item of items) {
    const base = item.href.split("?")[0];
    const prefix = item.match ?? base;
    const hit = pathname === base || pathname.startsWith(`${prefix}/`);
    if (hit && (!best || base.length > best.length)) best = base;
  }
  return best;
}
