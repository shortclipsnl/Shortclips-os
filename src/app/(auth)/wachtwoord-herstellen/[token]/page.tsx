import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { peekPortalToken } from "@/server/auth/portal-invites";
import { SetPasswordForm } from "../../set-password-form";

export const metadata: Metadata = { title: "Wachtwoord herstellen" };
export const dynamic = "force-dynamic";

export default async function WachtwoordHerstellenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await peekPortalToken(token);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-canvas)] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center"><Logo size={40} /></div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          {valid ? (
            <>
              <h1 className="mb-1 text-lg font-bold text-[var(--color-ink)]">Nieuw wachtwoord instellen</h1>
              <p className="mb-4 text-sm text-[var(--color-ink-muted)]">Kies een nieuw wachtwoord voor je ShortClips-portaal. Daarna log je direct in.</p>
              <SetPasswordForm token={token} purpose="reset" />
            </>
          ) : (
            <>
              <h1 className="mb-1 text-lg font-bold text-[var(--color-ink)]">Deze link werkt niet meer</h1>
              <p className="mb-4 text-sm text-[var(--color-ink-muted)]">De herstel-link is verlopen of al gebruikt. Vraag je contactpersoon bij ShortClips om een nieuwe link.</p>
              <Link href="/login" className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-line-strong)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">Naar inloggen</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
