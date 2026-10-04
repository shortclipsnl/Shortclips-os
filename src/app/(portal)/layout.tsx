import Link from "next/link";
import { requirePortal } from "@/server/auth/context";
import { Logo } from "@/components/logo";
import { Avatar } from "@/components/ui";
import { UserMenu } from "@/components/layout/user-menu";

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
      <main className="mx-auto max-w-[1100px] px-5 py-8">{children}</main>
      <footer className="mx-auto max-w-[1100px] px-5 pb-10 text-xs text-[var(--color-ink-faint)]">
        Deze omgeving is van jou. Vragen? Neem contact op met je vaste
        contactpersoon bij ShortClips.
      </footer>
    </div>
  );
}
