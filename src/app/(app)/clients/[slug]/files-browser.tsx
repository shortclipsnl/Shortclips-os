"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, FileText, Folder } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";

export type ClientFile = {
  id: string;
  name: string;
  category: string | null;
  isFolder: boolean;
  externalUrl: string | null;
  modifiedAt: string | Date | null;
  source?: string | null;
};

/**
 * Documenten als échte, aanklikbare mappen — net als in Google Drive. Op het
 * hoofdniveau zie je de mappen (per categorie); klik je er één aan, dan zie je de
 * bestanden daarin. Zo blijft het rustig en scanbaar in plaats van één lange,
 * platte lijst van alles door elkaar.
 */
export function FilesBrowser({ files }: { files: ClientFile[] }) {
  const [openFolder, setOpenFolder] = useState<string | null>(null);

  const { folders, driveUrlFor } = useMemo(() => {
    const docs = files.filter((f) => !f.isFolder);
    const map = new Map<string, ClientFile[]>();
    for (const f of docs) {
      const cat = (f.category ?? "").trim() || "Overig";
      const list = map.get(cat);
      if (list) list.push(f);
      else map.set(cat, [f]);
    }
    const folders = [...map.entries()]
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => a.name.localeCompare(b.name, "nl"));
    // Echte Drive-map met dezelfde naam → "open in Drive"-link.
    const driveUrlFor = (name: string) =>
      files.find((f) => f.isFolder && f.name.toLowerCase() === name.toLowerCase())?.externalUrl ?? null;
    return { folders, driveUrlFor };
  }, [files]);

  if (files.length === 0)
    return (
      <Card>
        <EmptyState
          title="Geen bestanden"
          description="Koppel de Google Drive-map van deze klant bij Koppelingen; de inhoud verschijnt dan hier."
          icon={<Folder className="size-6" />}
        />
      </Card>
    );

  const current = openFolder ? folders.find((f) => f.name === openFolder) ?? null : null;

  return (
    <Card padded={false}>
      {/* Kruimelpad: Documenten > map */}
      <div className="flex items-center gap-1.5 border-b border-[var(--color-line)] px-5 py-3 text-sm">
        <button
          type="button"
          onClick={() => setOpenFolder(null)}
          className={current ? "font-semibold text-[var(--color-brand-600)] hover:underline" : "font-semibold text-[var(--color-ink)]"}
        >
          Documenten
        </button>
        {current ? (
          <>
            <ChevronRight className="size-4 text-[var(--color-ink-faint)]" />
            <span className="font-semibold text-[var(--color-ink)]">{current.name}</span>
          </>
        ) : null}
      </div>

      {!current ? (
        // Hoofdniveau: de mappen om in te klikken.
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => setOpenFolder(f.name)}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-left transition-shadow hover:shadow-[var(--shadow-raised)]"
            >
              <Folder className="size-6 shrink-0 text-[var(--color-brand-500)]" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.name}</span>
                <span className="block text-xs text-[var(--color-ink-muted)]">
                  {f.items.length} bestand{f.items.length === 1 ? "" : "en"}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
            </button>
          ))}
        </div>
      ) : (
        // In een map: de bestanden eronder.
        <div>
          {driveUrlFor(current.name) ? (
            <a
              href={driveUrlFor(current.name)!}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
            >
              Deze map openen in Google Drive <ArrowUpRight className="size-3.5" />
            </a>
          ) : null}
          <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
            {current.items.map((f) => (
              <li key={f.id}>
                <a
                  href={f.externalUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-surface-sunken)]/60"
                >
                  <FileText className="size-5 shrink-0 text-[var(--color-ink-faint)]" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
                  <span className="hidden shrink-0 text-xs text-[var(--color-ink-faint)] md:block">{formatDate(f.modifiedAt)}</span>
                  <ArrowUpRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
