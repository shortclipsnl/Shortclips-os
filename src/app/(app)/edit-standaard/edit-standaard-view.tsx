"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { BookOpen, Check, ChevronDown, ExternalLink, ListChecks, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { EDIT_EINDCHECK, EDIT_STANDAARD, SHORTCLIPS_VOORBEELDEN_URL } from "@/lib/edit-standaard";

const STORAGE_KEY = "sc-edit-eindcheck";

/**
 * Vast kleuraccent per regel. Dezelfde kleur komt terug in het raster bovenaan
 * en in de uitleg per onderdeel, zodat regel 1 overal herkenbaar dezelfde is.
 * Gedempte tinten die zowel op de lichte als de donkere weergave goed lezen;
 * groen is bewust gereserveerd voor de eindcheck.
 */
const ACCENTS: Record<string, string> = {
  hook: "#e4572e",
  tempo: "#d9921a",
  ondertiteling: "#db2777",
  beeld: "#7c5cff",
  audio: "#4f5bd5",
  effecten: "#0891b2",
  broll: "#0d9488",
  originaliteit: "#b24fd0",
  export: "#6b7a99",
};
const FALLBACK_ACCENT = "#6b7a99";

function accentStyle(id: string): CSSProperties {
  return { "--acc": ACCENTS[id] ?? FALLBACK_ACCENT } as CSSProperties;
}

/** Sectiekop met nummer, zodat de drie hoofdsecties direct van elkaar te onderscheiden zijn. */
function SectionHeading({ step, title, sub, tone = "default" }: { step: number; title: string; sub: string; tone?: "default" | "good" }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-2xs font-bold",
          tone === "good" ? "bg-[var(--color-good)] text-white" : "bg-[var(--color-ink)] text-[var(--color-surface)]",
        )}
      >
        {step}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold leading-tight text-[var(--color-ink)]">{title}</h2>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{sub}</p>
      </div>
    </div>
  );
}

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
    <div className="flex flex-col gap-10">
      {/* 1. De standaard in één blik. */}
      <section>
        <SectionHeading step={1} title="De standaard in één blik" sub="Negen regels. Klik op een regel voor de uitleg." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EDIT_STANDAARD.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              style={accentStyle(s.id)}
              className="group relative flex h-full items-start gap-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 pl-5 text-left shadow-[var(--shadow-card)] transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[color:var(--acc)] hover:shadow-[var(--shadow-raised)] focus-visible:border-[color:var(--acc)]"
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--acc)]" />
              <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--acc)] text-sm font-bold text-white">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold leading-tight text-[var(--color-ink)]">{s.title}</span>
                <span className="mt-1 block text-[13px] leading-snug text-[var(--color-ink-muted)]">{s.scan}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] border-l-4 border-l-[var(--color-ink)] bg-[var(--color-surface-sunken)] px-4 py-3">
          <p className="text-sm text-[var(--color-ink)]">
            <span className="font-bold">De Editing Guide van de klant gaat altijd voor.</span>{" "}
            <span className="text-[var(--color-ink-muted)]">Staat daar iets anders dan hier, dan volg je de klant.</span>
          </p>
          <Link href="/mijn-klanten" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            <BookOpen className="size-4" /> Mijn klanten
          </Link>
        </div>
      </section>

      {/* 2. De eindcheck: direct onder de standaard, zodat niemand eerst door de uitleg hoeft. */}
      <section
        aria-labelledby="eindcheck-titel"
        className="rounded-[var(--radius-lg)] border border-[color:color-mix(in_srgb,var(--color-good)_45%,var(--color-line))] border-t-4 border-t-[var(--color-good)] bg-[color-mix(in_srgb,var(--color-good)_6%,var(--color-surface))] p-4 shadow-[var(--shadow-card)] sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-good)] text-white">
              <ListChecks className="size-5" />
            </span>
            <div>
              <h2 id="eindcheck-titel" className="text-lg font-bold leading-tight text-[var(--color-ink)]">
                Eindcheck voordat je oplevert
              </h2>
              <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">Loop dit per video door voordat je uploadt. Klaar met een video? Maak de lijst leeg voor de volgende.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-sm font-bold tabular-nums",
                complete ? "bg-[var(--color-good)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink)] ring-1 ring-[var(--color-line-strong)]",
              )}
            >
              {done} van {total}
            </span>
            <button
              type="button"
              onClick={() => store(EDIT_EINDCHECK.map(() => false))}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
            >
              <RotateCcw className="size-3.5" /> Leegmaken
            </button>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-good)_15%,var(--color-surface-2))]">
          <div className="h-full rounded-full bg-[var(--color-good)] transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {EDIT_EINDCHECK.map((label, i) => (
            <button
              key={label}
              type="button"
              role="checkbox"
              aria-checked={checked[i]}
              onClick={() => store(checked.map((c, j) => (j === i ? !c : c)))}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors",
                checked[i]
                  ? "border-[color:color-mix(in_srgb,var(--color-good)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-good)_12%,var(--color-surface))]"
                  : "border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-good)]",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
                  checked[i] ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)]",
                )}
              >
                {checked[i] ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
              <span className={cn("text-sm", checked[i] ? "text-[var(--color-ink-faint)] line-through" : "font-medium text-[var(--color-ink)]")}>{label}</span>
            </button>
          ))}
        </div>
        {complete ? (
          <p className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-good)] px-3 py-2.5 text-sm font-semibold text-white">
            <Check className="size-4" strokeWidth={3} /> Alles afgevinkt. Deze video kan naar Next Frame.
          </p>
        ) : null}
      </section>

      {/* 3. De uitleg per onderdeel, met hetzelfde kleuraccent als in het raster. */}
      <section>
        <SectionHeading step={3} title="Uitleg per onderdeel" sub="Klik op een onderdeel voor de volledige uitleg en wat je moet vermijden." />
        <div className="flex flex-col gap-3">
          {EDIT_STANDAARD.map((s, i) => {
            const isOpen = open === s.id;
            return (
              <div
                key={s.id}
                id={`onderdeel-${s.id}`}
                style={accentStyle(s.id)}
                className={cn(
                  "relative scroll-mt-20 overflow-hidden rounded-[var(--radius-md)] border bg-[var(--color-surface)] shadow-[var(--shadow-card)] transition-colors",
                  isOpen ? "border-[color:var(--acc)]" : "border-[var(--color-line)] hover:border-[color:color-mix(in_srgb,var(--acc)_55%,var(--color-line))]",
                )}
              >
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--acc)]" />
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`uitleg-${s.id}`}
                  onClick={() => setOpen(isOpen ? null : s.id)}
                  className={cn(
                    "flex w-full items-center gap-3 py-3.5 pl-5 pr-4 text-left transition-colors",
                    isOpen ? "bg-[color-mix(in_srgb,var(--acc)_10%,var(--color-surface))]" : "hover:bg-[color-mix(in_srgb,var(--acc)_6%,var(--color-surface))]",
                  )}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--acc)] text-sm font-bold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold leading-tight text-[var(--color-ink)]">{s.title}</span>
                    <span className="mt-0.5 block text-[13px] text-[var(--color-ink-muted)]">{s.scan}</span>
                  </span>
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
                      isOpen ? "bg-[var(--acc)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]",
                    )}
                  >
                    <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
                  </span>
                </button>
                {isOpen ? (
                  <div id={`uitleg-${s.id}`} className="grid gap-5 border-t border-[color:color-mix(in_srgb,var(--acc)_30%,var(--color-line))] py-4 pl-5 pr-4 md:grid-cols-[3fr_2fr]">
                    <div>
                      <div className="mb-2 text-2xs font-bold uppercase tracking-wide text-[var(--color-good)]">Zo doe je het</div>
                      <ul className="flex flex-col gap-2">
                        {s.rules.map((r) => (
                          <li key={r} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                            <Check className="mt-0.5 size-4 shrink-0 text-[var(--color-good)]" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-3">
                      <div className="mb-2 text-2xs font-bold uppercase tracking-wide text-[var(--color-bad)]">Hierdoor komt een video terug</div>
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
                          className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
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
      </section>
    </div>
  );
}
