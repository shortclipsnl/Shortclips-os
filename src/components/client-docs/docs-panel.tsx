import { ClientDocUpload } from "./doc-upload";
import type { DocSlot } from "@/server/client-documents";

function fmt(d: Date) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/**
 * Beheerblok voor het kernteam: per guide de huidige versie en een knop om te
 * uploaden of te vervangen. De vervanging is direct zichtbaar op Klanten, in de
 * Klantenbibliotheek en bij editors (allemaal dezelfde centrale bron).
 */
export function ClientDocsPanel({ clientId, slots }: { clientId: string; slots: DocSlot[] }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">Klant- en editing guides</h3>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        Eén centrale versie per document. Vervang je er een, dan staat de nieuwe direct bij Klanten, in de Klantenbibliotheek en bij de editors.
      </p>
      <ul className="mt-4 divide-y divide-[var(--color-line)]">
        {slots.map((s) => (
          <li key={`${s.kind}-${s.label}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-ink)]">{s.label}</p>
              <p className="truncate text-xs text-[var(--color-ink-faint)]">
                {s.doc ? `${s.doc.fileName} · bijgewerkt ${fmt(s.doc.updatedAt)}` : "Nog niet geüpload"}
              </p>
            </div>
            <span className="flex items-center gap-2">
              {s.doc ? (
                <a href={s.doc.url} target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-700)] hover:underline">
                  Openen
                </a>
              ) : null}
              <ClientDocUpload clientId={clientId} kind={s.kind} variant={s.doc?.variant ?? ""} label={s.label} hasDoc={Boolean(s.doc)} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
