import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/server/auth/context";
import { getPortalBranding } from "@/server/portal";
import { Logo } from "@/components/logo";
import { ClientLogo } from "@/components/ui";
import { UserMenu } from "@/components/layout/user-menu";
import { PortalNav, PortalMobileNav } from "./portal-nav";
import { PortalThemeToggle, PORTAL_THEME_INIT } from "./portal-theme";

/** Klantgerichte tabtitel: "Shortclips" (geen interne "OS"-toevoeging). */
export const metadata: Metadata = {
  title: { default: "Shortclips", template: "%s · Shortclips" },
};

/**
 * Het klantportaal staat bewust los van de interne app: eigen layout, eigen
 * navigatie, geen enkele verwijzing naar interne schermen.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requirePortal();
  const branding = await getPortalBranding(viewer);

  return (
    <div className="portal-studio flex min-h-screen text-[var(--color-ink)]">
      <script dangerouslySetInnerHTML={{ __html: PORTAL_THEME_INIT }} />

      {/* Sidebar — flush links, volle hoogte (zelfde uitlijning als het interne platform) */}
      <aside className="hidden w-56 shrink-0 border-r border-[var(--sc-line)] bg-[var(--color-surface)] lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="flex h-16 shrink-0 items-center border-b border-[var(--sc-line)] px-5">
            <Link href="/portal" aria-label="Naar je dashboard" className="inline-flex">
              <Logo size={28} onDark className="pl-dark" />
              <Logo size={28} className="pl-light" />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <PortalNav />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-[var(--sc-line)] bg-[var(--sc-header-bg)] px-5 backdrop-blur-md">
          {/* Mobiel: logo links (op desktop staat die in de sidebar) */}
          <Link href="/portal" aria-label="Naar je dashboard" className="mr-auto inline-flex lg:hidden">
            <Logo size={28} onDark className="pl-dark" />
            <Logo size={28} className="pl-light" />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-[var(--color-ink-muted)] sm:block">{branding.name}</span>
            <PortalThemeToggle />
            <UserMenu name={viewer.fullName} email={viewer.email} role="client">
              {/* Logo van de klant i.p.v. persoons-initialen (valt terug op
                  klant-initialen als er nog geen logo is geüpload). */}
              <ClientLogo name={branding.name} logoUrl={branding.logoUrl} color={branding.color} size={32} />
            </UserMenu>
          </div>
        </header>

        <main className="flex-1 px-5 py-6 pb-24 lg:px-8 lg:pb-8">
          {/* Links uitgelijnd (flush met de sidebar), maar op heel brede schermen
              begrensd zodat dashboards en tekst comfortabel leesbaar blijven. */}
          <div className="max-w-[1500px]">
            {children}
            <footer className="mt-10 text-xs text-[var(--color-ink-faint)]">
              Deze omgeving is van jou. Vragen? Neem contact op met je vaste
              contactpersoon bij Shortclips.
            </footer>
          </div>
        </main>
      </div>

      {/* Mobiele bottom-tab-bar (buiten de flow, vast onderin) */}
      <PortalMobileNav />
    </div>
  );
}
