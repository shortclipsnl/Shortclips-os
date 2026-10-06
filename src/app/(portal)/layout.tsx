import Link from "next/link";
import { requirePortal } from "@/server/auth/context";
import { Logo } from "@/components/logo";
import { Avatar } from "@/components/ui";
import { UserMenu } from "@/components/layout/user-menu";
import { PortalNav } from "./portal-nav";

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
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex h-16 max-w-[1100px] items-center justify-between gap-4 px-5">
          <Link href="/portal">
            <Logo size={30} />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[var(--color-ink-muted)] sm:block">
              {viewer.fullName}
            </span>
            <UserMenu name={viewer.fullName} email={viewer.email} role="client">
              <Avatar name={viewer.fullName} size={32} />
            </UserMenu>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-6 lg:flex-row lg:gap-8 lg:py-8">
        <aside className="lg:w-56 lg:shrink-0">
          <div className="lg:sticky lg:top-8">
            <PortalNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          {children}
          <footer className="mt-10 text-xs text-[var(--color-ink-faint)]">
            Deze omgeving is van jou. Vragen? Neem contact op met je vaste
            contactpersoon bij ShortClips.
          </footer>
        </main>
      </div>
    </div>
  );
}
