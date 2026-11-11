import type { Metadata } from "next";
import { ExternalLink, Send } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Bestanden versturen" };
export const dynamic = "force-dynamic";

/**
 * Shortclips Transfer is uitgefaseerd: grote bestanden versturen we voortaan
 * uitsluitend via WeTransfer. Deze pagina biedt alleen nog een knop naar
 * WeTransfer; de interne upload-/verstuurfunctionaliteit is verwijderd.
 */
export default async function TransferPage() {
  await requireInternal();
  return (
    <div className="mx-auto max-w-[640px]">
      <PageHeader
        title="Bestanden versturen"
        description="Grote bestanden versturen we extern via WeTransfer."
      />
      <div className="sc-card flex flex-col items-center gap-4 p-7 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
          <Send className="size-6" />
        </span>
        <p className="max-w-sm text-sm text-[var(--color-ink-muted)]">
          Shortclips Transfer is vervangen door WeTransfer. Gebruik WeTransfer om grote bestanden naar klanten of collega&apos;s te sturen.
          Uploads voor scripts en klantvideo&apos;s binnen het portaal blijven gewoon werken.
        </p>
        <a
          href="https://wetransfer.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          <ExternalLink className="size-4" /> Open WeTransfer
        </a>
      </div>
    </div>
  );
}
