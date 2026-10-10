import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth/context";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";
import { TeamMarquee } from "./team-marquee";

export const metadata: Metadata = { title: "Inloggen" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ verder?: string; reden?: string }>;
}) {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.isPortalUser ? "/portal" : "/dashboard");

  const params = await searchParams;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_460px]">
      {/* Merkzijde */}
      <section className="relative hidden overflow-hidden bg-[var(--color-indigo-ink)] lg:block">
        <div
          className="pointer-events-none absolute -top-40 -right-32 size-[520px] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #1B5FE0, transparent 70%)" }}
        />

        {/* Tekstkolom */}
        <div className="relative z-10 flex min-h-screen flex-col justify-between p-12 pr-[272px] xl:pr-[312px]">
          <div className="flex items-center gap-3">
            <Logo size={56} onDark />
            <span className="rounded-full border border-white/20 px-2.5 py-1 text-2xs font-semibold tracking-[0.14em] text-white/70 uppercase">
              Operating System
            </span>
          </div>

          <div className="max-w-md">
            <h1 className="text-3xl leading-tight font-semibold text-white">
              Eén platform voor de complete videoworkflow.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              Klanten, strategie, scripts, opnamedagen, edit, goedkeuring,
              planning, publicatie, resultaten en facturatie — bij elkaar, op één
              plek, zonder te wisselen tussen systemen.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-white/60">
              {[
                "Elke klant één pagina met alles wat speelt",
                "Video's van opname tot publicatie in één pipeline",
                "Monday, Frame.io en Drive onder de motorkap",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-400)]" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/40">
            Interne omgeving van ShortClips. Toegang uitsluitend op uitnodiging.
          </p>
        </div>

        {/* Teamfoto's — bewegen rustig van boven naar beneden door het blauwe vlak. */}
        <div className="absolute inset-y-0 right-0 z-0 w-[240px] py-6 pr-6 xl:w-[280px]">
          <TeamMarquee />
        </div>
      </section>

      {/* Formulier */}
      <section className="flex items-center justify-center bg-[var(--color-canvas)] px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={48} />
          </div>
          <h2 className="text-xl font-semibold text-[var(--color-ink)]">
            Inloggen
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Gebruik je ShortClips-account.
          </p>

          {params.reden === "geen-klant" ? (
            <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[#8a5300]">
              Aan dit account is nog geen klantomgeving gekoppeld. Neem contact
              op met je contactpersoon bij ShortClips.
            </p>
          ) : null}

          <LoginForm next={params.verder} />
        </div>
      </section>
    </main>
  );
}
