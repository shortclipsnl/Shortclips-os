import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalBranding } from "@/server/portal";
import { getPortalActionCounts } from "@/server/portal-frame";
import { getUnreadNotificationCount } from "@/server/client-app";
import { pushConfigured, vapidPublicKey } from "@/server/push";
import { Logo } from "@/components/logo";
import { ClientLogo } from "@/components/ui";
import { UserMenu } from "@/components/layout/user-menu";
import { PortalAppRuntime } from "@/components/portal-app/app-runtime";
import { InstallBanner } from "@/components/portal-app/install-banner";
import { PortalNav, PortalMobileNav, PortalMenuButton, PortalSectionSwitch } from "./portal-nav";
import { PortalThemeToggle, PORTAL_THEME_INIT } from "./portal-theme";

/** Klantgerichte tabtitel: "Shortclips" (geen interne "OS"-toevoeging). */
export const metadata: Metadata = {
  title: { default: "Shortclips", template: "%s · Shortclips" },
  appleWebApp: { capable: true, title: "Shortclips", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

/** Tot in de hoeken van het scherm; tabbalk houdt rekening met de thuisbalk. */
export const viewport: Viewport = {
  themeColor: "#00003B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Het klantportaal staat bewust los van de interne app: eigen layout, eigen
 * navigatie, geen enkele verwijzing naar interne schermen. Desktop en mobiel
 * zijn dezelfde pagina's; alleen de navigatie verschilt.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requirePortal();
  // Tellers voor de tabs en het belletje. Nooit de pagina laten falen.
  const [branding, actions, unread] = await Promise.all([
    getPortalBranding(viewer),
    getPortalActionCounts(viewer).catch(() => ({ videos: 0, scripts: 0 })),
    getUnreadNotificationCount(viewer).catch(() => 0),
  ]);
  const counts = { ...actions, unread };
  const vapidKey = pushConfigured() ? vapidPublicKey() : null;

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
            <PortalNav counts={counts} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--sc-line)] bg-[var(--sc-header-bg)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center gap-1 px-4 lg:h-16 lg:gap-2 lg:px-5">
            {/* Mobiel: logo links (op desktop staat die in de sidebar) */}
            <Link href="/portal" aria-label="Naar je dashboard" className="mr-auto inline-flex lg:hidden">
              <Logo size={26} onDark className="pl-dark" />
              <Logo size={26} className="pl-light" />
            </Link>
            <div className="ml-auto flex items-center gap-1 lg:gap-2">
              <span className="hidden text-sm text-[var(--color-ink-muted)] sm:block">{branding.name}</span>
              <Link
                href="/portal/meldingen"
                aria-label={unread > 0 ? `Meldingen, ${unread} nieuw` : "Meldingen"}
                className="relative inline-flex size-10 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--sc-fill)] hover:text-[var(--color-ink)]"
              >
                <Bell className="size-5" strokeWidth={1.8} />
                {unread > 0 ? (
                  <span className="absolute right-1.5 top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-[var(--color-bad)] px-1 text-[10px] font-bold leading-4 text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </Link>
              <PortalThemeToggle />
              <UserMenu name={viewer.fullName} email={viewer.email} role="client">
                {/* Logo van de klant i.p.v. persoons-initialen (valt terug op
                    klant-initialen als er nog geen logo is geüpload). */}
                <ClientLogo name={branding.name} logoUrl={branding.logoUrl} color={branding.color} size={32} />
              </UserMenu>
              <PortalMenuButton counts={counts} />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+6rem)] sm:px-5 lg:px-8 lg:py-6 lg:pb-8">
          {/* Links uitgelijnd (flush met de sidebar), maar op heel brede schermen
              begrensd zodat dashboards en tekst comfortabel leesbaar blijven. */}
          <div className="max-w-[1500px]">
            <InstallBanner vapidPublicKey={vapidKey} />
            <PortalSectionSwitch />
            {children}
            <footer className="mt-10 text-xs text-[var(--color-ink-faint)]">
              Deze omgeving is van jou. Vragen? Neem contact op met je vaste
              contactpersoon bij Shortclips.
            </footer>
          </div>
        </main>
      </div>

      {/* Mobiele bottom-tab-bar (buiten de flow, vast onderin) */}
      <PortalMobileNav counts={counts} />
      <PortalAppRuntime pushEnabled={Boolean(vapidKey)} />
    </div>
  );
}
