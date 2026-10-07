import Link from "next/link";
import { requirePortal } from "@/server/auth/context";
import { Logo } from "@/components/logo";
import { Avatar } from "@/components/ui";
import { UserMenu } from "@/components/layout/user-menu";
import { PortalNav, PortalMobileNav } from "./portal-nav";

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

  return (
    <div className="portal-studio min-h-screen text-[var(--color-ink)]">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[rgba(5,6,29,0.65)] text-white backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-5">
          <Link href="/portal" aria-label="Naar je dashboard">
            <Logo size={30} onDark />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-white/70 sm:block">
              {viewer.fullName}
            </span>
            <UserMenu name={viewer.fullName} email={viewer.email} role="client">
              <Avatar name={viewer.fullName} size={32} />
            </UserMenu>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-6 lg:flex-row lg:gap-8 lg:py-8">
        <aside className="hidden lg:block lg:w-52 lg:shrink-0">
          <div className="lg:sticky lg:top-[88px]">
            <PortalNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1 pb-24 lg:pb-0">
          {children}
          <footer className="mt-10 text-xs text-[var(--color-ink-faint)]">
            Deze omgeving is van jou. Vragen? Neem contact op met je vaste
            contactpersoon bij ShortClips.
          </footer>
        </main>
      </div>

      {/* Mobiele bottom-tab-bar (buiten de flow, vast onderin) */}
      <PortalMobileNav />
    </div>
  );
}
