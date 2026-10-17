/**
 * Rechtenmodel van ShortClips OS.
 *
 * Sleutels hebben het formaat `resource:action`. De catalogus hieronder is de
 * bron: de seed schrijft hem naar de database, waarna een beheerder rollen mag
 * aanpassen zonder dat er code hoeft te veranderen.
 */
export const PERMISSIONS = {
  // Klanten
  "clients:read": "Klanten en klantpagina's bekijken",
  "clients:write": "Klanten aanmaken en wijzigen",
  "clients:delete": "Klanten archiveren",
  "clients:read_all": "Alle klanten zien (zonder dit recht alleen toegewezen klanten)",

  // Klantkennis
  "knowledge:read": "Klantkennis bekijken",
  "knowledge:write": "Klantkennis toevoegen en wijzigen",

  // Scripts
  "scripts:read": "Scripts bekijken",
  "scripts:write": "Scripts schrijven en wijzigen",
  "scripts:approve": "Scripts intern goedkeuren",

  // Producties
  "productions:read": "Opnamedagen bekijken",
  "productions:write": "Opnamedagen plannen en wijzigen",

  // Video's
  "videos:read": "Video's bekijken",
  "videos:write": "Video's aanmaken en wijzigen",
  "videos:assign": "Editors toewijzen",
  "videos:approve": "Video's intern goedkeuren",
  "videos:publish": "Video's inplannen en publiceren",

  // Review
  "comments:read_internal": "Interne opmerkingen lezen",
  "comments:write_internal": "Interne opmerkingen plaatsen",
  "comments:write_client": "Opmerkingen richting klant plaatsen",

  // Planning
  "calendar:read": "Contentplanning bekijken",
  "calendar:write": "Contentplanning wijzigen",

  // Taken
  "tasks:read": "Taken bekijken",
  "tasks:write": "Taken aanmaken en wijzigen",

  // Statistieken en rapportage
  "analytics:read": "Statistieken bekijken",
  "reports:read": "Rapportages bekijken",
  "reports:write": "Rapportages maken en publiceren",

  // Finance — bewust strikt
  "finance:read": "Omzet, facturen en marges bekijken",
  "finance:write": "Facturen en betalingen beheren",
  "finance:read_costs": "Editorkosten en marges bekijken",

  // Team
  "team:read": "Teamleden en capaciteit bekijken",
  "team:write": "Teamleden en planning beheren",
  "editors:read": "Editorprestaties bekijken",
  "editors:write": "Editors beheren",

  // AI
  "ai:read": "AI-inzichten bekijken",
  "ai:run": "AI-analyses starten",

  // Video Intelligence
  "video_intelligence:read": "Video Intelligence-analyses bekijken",
  "video_intelligence:run": "Video's toevoegen en laten analyseren",

  // Beheer
  "integrations:read": "Koppelingen en hun status bekijken",
  "integrations:write": "Koppelingen instellen en synchronisatie starten",
  "automations:read": "Automatiseringen bekijken",
  "automations:write": "Automatiseringen wijzigen",
  "settings:read": "Instellingen bekijken",
  "settings:write": "Instellingen wijzigen",
  "users:read": "Gebruikers bekijken",
  "users:write": "Gebruikers en rollen beheren",
  "audit:read": "Audit log bekijken",
  "import:run": "Importwizard gebruiken",

  // Klantportaal
  "portal:access": "Toegang tot het klantportaal",
  "portal:approve": "Als klant goedkeuren",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

const INTERNAL_BASE: PermissionKey[] = [
  "clients:read",
  "knowledge:read",
  "scripts:read",
  "productions:read",
  "videos:read",
  "calendar:read",
  "tasks:read",
  "tasks:write",
  "comments:read_internal",
  "comments:write_internal",
];

/**
 * Standaardrechten per rol. Dit is de startsituatie na de seed; daarna is alles
 * per rol aanpasbaar in Instellingen → Rollen.
 */
export const ROLE_DEFINITIONS: Array<{
  key: string;
  name: string;
  description: string;
  isPortalRole?: boolean;
  sortOrder: number;
  permissions: PermissionKey[] | "*";
}> = [
  {
    key: "owner",
    name: "Eigenaar",
    description: "Volledige toegang tot alles, inclusief finance en beheer.",
    sortOrder: 10,
    permissions: "*",
  },
  {
    key: "admin",
    name: "Beheerder",
    description: "Technisch en functioneel beheer. Finance is uitsluitend voor de eigenaar.",
    sortOrder: 20,
    permissions: ALL_PERMISSIONS.filter(
      (p) => !p.startsWith("finance:") && !p.startsWith("portal:"),
    ),
  },
  {
    key: "project_coordinator",
    name: "Projectcoördinator",
    description:
      "Stuurt de dagelijkse operatie: klanten, scripts, opnames, video's, planning.",
    sortOrder: 30,
    permissions: [
      ...INTERNAL_BASE,
      "clients:read_all",
      "clients:write",
      "knowledge:write",
      "scripts:write",
      "scripts:approve",
      "productions:write",
      "videos:write",
      "videos:assign",
      "videos:approve",
      "videos:publish",
      "comments:write_client",
      "calendar:write",
      "analytics:read",
      "reports:read",
      "reports:write",
      "team:read",
      "editors:read",
      "ai:read",
      "ai:run",
      "video_intelligence:read",
      "video_intelligence:run",
      "integrations:read",
      "automations:read",
    ],
  },
  {
    key: "content_creator",
    name: "Content creator",
    description: "Schrijft scripts en bereidt content voor.",
    sortOrder: 40,
    permissions: [
      ...INTERNAL_BASE,
      "clients:read_all",
      "knowledge:write",
      "scripts:write",
      "calendar:write",
      "analytics:read",
      "ai:read",
      "video_intelligence:read",
    ],
  },
  {
    key: "videographer",
    name: "Videograaf",
    description: "Draait opnamedagen; ziet scripts en benodigdheden.",
    sortOrder: 50,
    permissions: [...INTERNAL_BASE, "productions:write"],
  },
  {
    key: "editor",
    name: "Editor",
    description:
      "Ziet uitsluitend toegewezen video's met script, materiaal en feedback. Geen financiële klantinformatie.",
    sortOrder: 60,
    permissions: [
      "clients:read",
      "scripts:read",
      "videos:read",
      "videos:write",
      "comments:read_internal",
      "comments:write_internal",
      "tasks:read",
    ],
  },
  {
    key: "finance",
    name: "Finance",
    description:
      "Rapportage en klantoverzicht. Let op: het Finance-onderdeel (omzet, kosten, marges) is uitsluitend zichtbaar voor de eigenaar.",
    sortOrder: 70,
    permissions: [
      "clients:read",
      "clients:read_all",
      "editors:read",
      "reports:read",
      "analytics:read",
      "video_intelligence:read",
    ],
  },
  {
    key: "client",
    name: "Klant",
    description:
      "Klantportaal: eigen omgeving, eigen video's, eigen resultaten. Geen interne informatie.",
    isPortalRole: true,
    sortOrder: 80,
    permissions: ["portal:access", "portal:approve"],
  },
];

export function permissionsForRole(key: string): PermissionKey[] {
  const role = ROLE_DEFINITIONS.find((r) => r.key === key);
  if (!role) return [];
  return role.permissions === "*" ? ALL_PERMISSIONS : role.permissions;
}
