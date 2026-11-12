import { BookOpen, Clapperboard, Film } from "lucide-react";
import type { ClientDocumentKind } from "@/db/schema";

/**
 * De twee vaste PDF-knoppen per klant (Klanten Guide, Editing Guide). Iedere
 * knop opent de vaste link uit de centrale bron in een nieuw tabblad; ontbreekt
 * het document nog, dan staat de knop grijs met "volgt".
 *
 * Bewust zonder server-only imports, zodat hij ook in client components
 * (zoals het klantenbord) gebruikt kan worden.
 */
export type DocButtonSlot = { kind: ClientDocumentKind; label: string; url: string | null; updatedAt?: string | Date | null };

const ICON: Record<ClientDocumentKind, typeof BookOpen> = { klanten_guide: BookOpen, editing_guide: Clapperboard };

export function ClientDocButtons({
  slots,
  size = "sm",
  className = "",
  videosHref,
}: {
  slots: DocButtonSlot[];
  size?: "xs" | "sm";
  className?: string;
  /** Link naar het videooverzicht van de klant (knop "Short video's"). */
  videosHref?: string;
}) {
  const pad = size === "xs" ? "px-2.5 py-1 text-2xs gap-1" : "px-3 py-1.5 text-xs gap-1.5";
  const icon = size === "xs" ? "size-3.5" : "size-4";
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {slots.map((s) => {
        const Icon = ICON[s.kind];
        if (!s.url) {
          return (
            <span
              key={`${s.kind}-${s.label}`}
              title={`${s.label} is nog niet geüpload`}
              className={`inline-flex cursor-not-allowed items-center whitespace-nowrap rounded-full border border-dashed border-[var(--color-line-strong)] font-medium text-[var(--color-ink-faint)] ${pad}`}
            >
              <Icon className={icon} strokeWidth={1.75} />
              {s.label}
              <span className="font-normal">· volgt</span>
            </span>
          );
        }
        return (
          <a
            key={`${s.kind}-${s.label}`}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${s.label} openen (PDF)`}
            // Editing Guide: tekstkleur van het thema (licht = navy, donker = lichte tekst),
            // zodat de omlijnde knop in beide modi duidelijk opvalt.
            className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold transition hover:opacity-90 ${pad} ${
              s.kind === "klanten_guide"
                ? "bg-[var(--color-indigo-ink)] text-white"
                : "border border-[var(--color-ink)] bg-[var(--color-surface)] text-[var(--color-ink)]"
            }`}
          >
            <Icon className={icon} strokeWidth={1.75} />
            {s.label}
          </a>
        );
      })}
      {videosHref ? (
        <a
          href={videosHref}
          title="Alle video's van deze klant per opnamesessie"
          className={`inline-flex items-center whitespace-nowrap rounded-full border border-[var(--color-ink)] bg-[var(--color-surface)] font-semibold text-[var(--color-ink)] transition hover:opacity-90 ${pad}`}
        >
          <Film className={icon} strokeWidth={1.75} />
          Short video&apos;s
        </a>
      ) : null}
    </span>
  );
}
