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
      { href: "/videos", label: "Video's", icon: "Clapperboard", permissions: ["videos:read"], match: "/videos" },
      { href: "/scripts", label: "Scripts", icon: "FileText", permissions: ["scripts:read"], match: "/scripts" },
      { href: "/productions", label: "Opnames", icon: "Camera", permissions: ["productions:read"], match: "/productions" },
      { href: "/calendar", label: "Planning", icon: "CalendarDays", permissions: ["calendar:read"], match: "/calendar" },
      { href: "/tasks", label: "Taken", icon: "CircleCheck", permissions: ["tasks:read"], match: "/tasks" },
    ],
  },
  {
    title: "Inzicht",
    items: [
      { href: "/analytics", label: "Resultaten", icon: "TrendingUp", permissions: ["analytics:read"], match: "/analytics" },
      { href: "/insights", label: "AI-inzichten", icon: "Sparkles", permissions: ["ai:read"], match: "/insights" },
      { href: "/team", label: "Team", icon: "Users", permissions: ["team:read", "editors:read"], match: "/team" },
      { href: "/finance", label: "Finance", icon: "Euro", permissions: ["finance:read"], match: "/finance" },
    ],
  },
  {
    title: "Beheer",
    items: [
      { href: "/settings/integrations", label: "Koppelingen", icon: "Plug", permissions: ["integrations:read"], match: "/settings/integrations" },
      { href: "/settings", label: "Instellingen", icon: "Settings", permissions: ["settings:read", "users:read"], match: "/settings" },
    ],
  },
];
