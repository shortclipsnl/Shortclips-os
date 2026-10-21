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
  path?: string | null;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "nl");
const sortFiles = (items: ClientFile[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, "nl"));

/**
 * Documenten als échte, aanklikbare mappen — net als in Google Drive, met drie
 * niveaus: categorie → sessie → bestanden. De sessie is de submap waarin het
 * bestand in Drive staat (afgeleid uit het pad). Zo is in één oogopslag duidelijk
 * welke PowerPoint- en PDF-bestanden bij welke sessie horen, in plaats van één
 * lange platte lijst van alles door elkaar.
 */
export function FilesBrowser({ files }: { files: ClientFile[] }) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);

  const { categories, driveUrlFor } = useMemo(() => {
    const docs = files.filter((f) => !f.isFolder);
    const catMap = new Map<string, { sessions: Map<string, ClientFile[]>; loose: ClientFile[] }>();
    for (const f of docs) {
      const cat = (f.category ?? "").trim() || "Overig";
      const entry = catMap.get(cat) ?? { sessions: new Map<string, ClientFile[]>(), loose: [] };
      // Sessie = de submap tussen de categorie en het bestand. We ankeren op het
      // categoriesegment in het pad: staan er daarná minstens twee segmenten
      // (submap + bestandsnaam), dan is het eerste daarvan de sessie. Zo niet,
      // dan staat het bestand los in de categoriemap. Robuust voor paden mét en
      // zonder bestandsnaam.
      const segs = (f.path ?? "").split("/").filter(Boolean);
      const catIdx = segs.findIndex((s) => s.toLowerCase() === cat.toLowerCase());
      let session: string | null = null;
      if (catIdx >= 0) {
        const after = segs.slice(catIdx + 1);
        if (after.length >= 2) session = after[0]!;
      } else if (segs.length >= 3) {
        const parent = segs[segs.length - 2]!;
        if (parent.toLowerCase() !== cat.toLowerCase()) session = parent;
      }
      if (session) {
        const list = entry.sessions.get(session) ?? [];
        list.push(f);
        entry.sessions.set(session, list);
      } else {
        entry.loose.push(f);
      }
      catMap.set(cat, entry);
    }
    const categories = [...catMap.entries()]
      .map(([name, e]) => ({
        name,
        sessions: [...e.sessions.entries()].map(([sName, items]) => ({ name: sName, items: sortFiles(items) })).sort(byName),
        loose: sortFiles(e.loose),
        count: [...e.sessions.values()].reduce((a, l) => a + l.length, 0) + e.loose.length,
      }))
      .sort(byName);
    // Echte Drive-map met dezelfde naam → "open in Drive"-link.
    const driveUrlFor = (name: string) =>
      files.find((f) => f.isFolder && f.name.toLowerCase() === name.toLowerCase())?.externalUrl ?? null;
    return { categories, driveUrlFor };
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

  const cat = openCat ? categories.find((c) => c.name === openCat) ?? null : null;
  const session = cat && openSession ? cat.sessions.find((s) => s.name === openSession) ?? null : null;

  const openCategory = (name: string) => {
    setOpenCat(name);
    setOpenSession(null);
  };

  const FileList = ({ items }: { items: ClientFile[] }) => (
    <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
      {items.map((f) => (
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
  );

  const DriveLink = ({ name }: { name: string }) =>
    driveUrlFor(name) ? (
      <a
        href={driveUrlFor(name)!}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
      >
        Deze map openen in Google Drive <ArrowUpRight className="size-3.5" />
      </a>
    ) : null;

  return (
    <Card padded={false}>
      {/* Kruimelpad: Documenten > categorie > sessie */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-line)] px-5 py-3 text-sm">
        <button
          type="button"
          onClick={() => {
            setOpenCat(null);
            setOpenSession(null);
          }}
          className={cat ? "font-semibold text-[var(--color-brand-600)] hover:underline" : "font-semibold text-[var(--color-ink)]"}
        >
          Documenten
        </button>
        {cat ? (
          <>
            <ChevronRight className="size-4 text-[var(--color-ink-faint)]" />
            <button
              type="button"
              onClick={() => setOpenSession(null)}
              className={session ? "font-semibold text-[var(--color-brand-600)] hover:underline" : "font-semibold text-[var(--color-ink)]"}
            >
              {cat.name}
            </button>
          </>
        ) : null}
        {session ? (
          <>
            <ChevronRight className="size-4 text-[var(--color-ink-faint)]" />
            <span className="font-semibold text-[var(--color-ink)]">{session.name}</span>
          </>
        ) : null}
      </div>

      {!cat ? (
        // Niveau 1 — de categoriemappen.
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => openCategory(c.name)}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-left transition-shadow hover:shadow-[var(--shadow-raised)]"
            >
              <Folder className="size-6 shrink-0 text-[var(--color-brand-500)]" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-[var(--color-ink-muted)]">
                  {c.sessions.length > 0 ? `${c.sessions.length} sessie${c.sessions.length === 1 ? "" : "s"} · ` : ""}
                  {c.count} bestand{c.count === 1 ? "" : "en"}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
            </button>
          ))}
        </div>
      ) : !session ? (
        // Niveau 2 — binnen een categorie: de sessiemappen, en losse bestanden eronder.
        <div>
          <DriveLink name={cat.name} />
          {cat.sessions.length > 0 ? (
            <div className="grid gap-2 border-t border-[var(--color-line)] p-4 sm:grid-cols-2 lg:grid-cols-3">
              {cat.sessions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setOpenSession(s.name)}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-left transition-shadow hover:shadow-[var(--shadow-raised)]"
                >
                  <Folder className="size-6 shrink-0 text-[var(--color-brand-500)]" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">
                      {s.items.length} bestand{s.items.length === 1 ? "" : "en"}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                </button>
              ))}
            </div>
          ) : null}
          {cat.loose.length > 0 ? (
            <div>
              {cat.sessions.length > 0 ? (
                <div className="px-5 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                  Losse bestanden
                </div>
              ) : null}
              <FileList items={cat.loose} />
            </div>
          ) : cat.sessions.length === 0 ? (
            <div className="px-5 py-6 text-sm text-[var(--color-ink-muted)]">Geen bestanden in deze map.</div>
          ) : null}
        </div>
      ) : (
        // Niveau 3 — de bestanden binnen een sessie.
        <div>
          <DriveLink name={session.name} />
          <FileList items={session.items} />
        </div>
      )}
    </Card>
  );
}
