"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, ChevronRight, ExternalLink, RotateCcw, X } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { EDIT_EINDCHECK, EDIT_STANDAARD, SHORTCLIPS_VOORBEELDEN_URL } from "@/lib/edit-standaard";

const STORAGE_KEY = "sc-edit-eindcheck";

export function EditStandaardView() {
  const [open, setOpen] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>(() => EDIT_EINDCHECK.map(() => false));

  // De eindcheck onthoudt zijn stand op dit apparaat, zodat je halverwege verder kunt.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      // Eenmalig inlezen uit de browseropslag na het laden (kan niet tijdens server-render).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(saved) && saved.length === EDIT_EINDCHECK.length) setChecked(saved.map(Boolean));
    } catch {
      /* geen opslag beschikbaar: de checklist werkt dan gewoon zonder onthouden */
    }
  }, []);

  function store(next: boolean[]) {
    setChecked(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* zie hierboven */
    }
  }

  function jump(id: string) {
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`onderdeel-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const done = checked.filter(Boolean).length;
  const total = EDIT_EINDCHECK.length;
  const complete = done === total;

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Het scanblok: de hele standaard in één blik. */}
      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[var(--color-ink)]">De standaard in één blik</h2>
            <p className="text-xs text-[var(--color-ink-muted)]">Negen regels. Klik op een regel voor de uitleg.</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EDIT_STANDAARD.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              className="group flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-left transition-colors hover:border-[var(--color-brand-500)]"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] text-xs font-bold text-white">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{s.title}</span>
                <span className="block text-sm font-semibold leading-snug text-[var(--color-ink)]">{s.scan}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-3 py-2.5">
          <p className="text-sm text-[var(--color-ink)]">
            <span className="font-semibold">De Editing Guide van de klant gaat altijd voor.</span>{" "}
            <span className="text-[var(--color-ink-muted)]">Staat daar iets anders dan hier, dan volg je de klant.</span>
          </p>
          <Link href="/mijn-klanten" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            <BookOpen className="size-4" /> Mijn klanten
          </Link>
        </div>
      </Card>

      {/* 2. De uitleg per onderdeel. */}
      <div>
        <h2 className="mb-2 text-base font-bold text-[var(--color-ink)]">Uitleg per onderdeel</h2>
        <div className="flex flex-col gap-2">
          {EDIT_STANDAARD.map((s, i) => {
            const isOpen = open === s.id;
            return (
              <div key={s.id} id={`onderdeel-${s.id}`} className="sc-card scroll-mt-20 overflow-hidden">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : s.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)]"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] text-xs font-bold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--color-ink)]">{s.title}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">{s.scan}</span>
                  </span>
                  <ChevronRight className={cn("size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform", isOpen && "rotate-90")} />
                </button>
                {isOpen ? (
                  <div className="grid gap-4 border-t border-[var(--color-line)] px-4 py-4 md:grid-cols-[3fr_2fr]">
                    <div>
                      <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-good)]">Zo doe je het</div>
                      <ul className="flex flex-col gap-2">
                        {s.rules.map((r) => (
                          <li key={r} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                            <Check className="mt-0.5 size-4 shrink-0 text-[var(--color-good)]" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-bad)]">Hierdoor komt een video terug</div>
                      <ul className="flex flex-col gap-2">
                        {s.avoid.map((r) => (
                          <li key={r} className="flex items-start gap-2 text-sm text-[var(--color-ink-muted)]">
                            <X className="mt-0.5 size-4 shrink-0 text-[var(--color-bad)]" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                      {s.id === "originaliteit" ? (
                        <a
                          href={SHORTCLIPS_VOORBEELDEN_URL}
                          target="_blank"
                          rel="noopener"
                          className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
                        >
                          <ExternalLink className="size-4" /> Shortclips voorbeelden bekijken
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. De eindcheck voor oplevering. */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--color-ink)]">Eindcheck voor je oplevert</h2>
            <p className="text-xs text-[var(--color-ink-muted)]">Loop dit per video door voordat je uploadt. Klaar met een video? Maak de lijst leeg voor de volgende.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("text-sm font-bold tabular-nums", complete ? "text-[var(--color-good)]" : "text-[var(--color-ink)]")}>
              {done} van {total}
            </span>
            <button
              type="button"
              onClick={() => store(EDIT_EINDCHECK.map(() => false))}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
            >
              <RotateCcw className="size-3.5" /> Leegmaken
            </button>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            className={cn("h-full rounded-full transition-[width]", complete ? "bg-[var(--color-good)]" : "bg-[var(--color-brand-500)]")}
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
        <div className="mt-3 grid gap-x-4 sm:grid-cols-2">
          {EDIT_EINDCHECK.map((label, i) => (
            <button
              key={label}
              type="button"
              role="checkbox"
              aria-checked={checked[i]}
              onClick={() => store(checked.map((c, j) => (j === i ? !c : c)))}
              className="flex items-start gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 text-left hover:bg-[var(--color-surface-2)]"
            >
              <span
                className={cn(
                  "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border",
                  checked[i] ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)]",
                )}
              >
                {checked[i] ? <Check className="size-3.5" /> : null}
              </span>
              <span className={cn("text-sm", checked[i] ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink)]")}>{label}</span>
            </button>
          ))}
        </div>
        {complete ? (
          <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-good-soft)] px-3 py-2 text-sm font-semibold text-[var(--color-good)]">
            Alles afgevinkt. Deze video kan naar Next Frame.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
