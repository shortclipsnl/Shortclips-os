import { requireInternal } from "@/server/auth/context";
import { SettingsNav } from "./nav";

const SECTIONS = [
  { href: "/settings", label: "Overzicht", permission: null },
  { href: "/settings/integrations", label: "Koppelingen", permission: "integrations:read" },
  { href: "/settings/import", label: "Importeren", permission: "import:run" },
  { href: "/settings/users", label: "Gebruikers", permission: "users:read" },
  { href: "/settings/roles", label: "Rollen en rechten", permission: "users:read" },
  { href: "/settings/automations", label: "Automatiseringen", permission: "automations:read" },
  { href: "/settings/statuses", label: "Statussen", permission: "settings:read" },
  { href: "/settings/audit", label: "Audit log", permission: "audit:read" },
  { href: "/settings/health", label: "Systeemstatus", permission: "settings:read" },
] as const;

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requireInternal();
  const items = SECTIONS.filter(
    (s) => !s.permission || viewer.permissions.has(s.permission),
  ).map((s) => ({ href: s.href, label: s.label }));

  return (
    <div className="mx-auto max-w-[1300px]">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Instellingen</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Beheer van gebruikers, rechten, koppelingen en systeemgedrag.
        </p>
      </div>
      <SettingsNav items={items} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
