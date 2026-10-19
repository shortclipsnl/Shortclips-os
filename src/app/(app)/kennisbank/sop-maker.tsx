"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookPlus, Check, Loader2, Sparkles, X } from "lucide-react";
import { createLesson, generateSop, kennisbankChaptersForCourse, saveLesson } from "@/server/actions/kennisbank";
import { EMPTY_DOC } from "@/lib/kennisbank-doc";
import { Button, ErrorNote } from "@/components/ui";

type Course = { id: string; title: string };
type KbDocLite = { type: "doc"; content?: unknown[] };

/**
 * SOP-maker: één knop om overal in de kennisbank een nieuwe SOP te maken. Je
 * kiest de categorie (cursus + hoofdstuk), laat optioneel een concept in onze
 * huisstijl genereren, en gaat daarna direct door naar de editor om te
 * verfijnen en te publiceren.
 */
export function SopMaker({ courses, aiReady }: { courses: Course[]; aiReady: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-600)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)]"
      >
        <BookPlus className="size-4" /> SOP maker
      </button>
      {open ? <SopDialog courses={courses} aiReady={aiReady} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SopDialog({ courses, aiReady, onClose }: { courses: Course[]; aiReady: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [chapters, setChapters] = useState<{ id: string; title: string }[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [content, setContent] = useState<KbDocLite | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [genPending, startGen] = useTransition();
  const [createPending, startCreate] = useTransition();
  const router = useRouter();

  // Hoofdstukken van de gekozen cursus laden (categorie-keuze).
  useEffect(() => {
    if (!courseId) {
      setChapters([]);
      return;
    }
    let active = true;
    void kennisbankChaptersForCourse(courseId).then((r) => {
      if (!active) return;
      setChapters(r.chapters);
      setChapterId("");
    });
    return () => {
      active = false;
    };
  }, [courseId]);

  function generate() {
    if (!topic.trim() && !title.trim()) {
      setErr("Beschrijf kort waar de SOP over gaat.");
      return;
    }
    setErr(null);
    startGen(async () => {
      const res = await generateSop({ title, topic });
      if (res.ok) setContent(res.content as KbDocLite);
      else {
        setContent(null);
        setErr(res.message);
      }
    });
  }

  function create() {
    if (!title.trim()) {
      setErr("Geef de SOP een titel.");
      return;
    }
    if (!courseId) {
      setErr("Kies een categorie (cursus).");
      return;
    }
    setErr(null);
    startCreate(async () => {
      const made = await createLesson(courseId, chapterId || null, title.trim());
      if (!made.ok || !made.id) {
        setErr(made.message ?? "Aanmaken mislukt.");
        return;
      }
      const saved = await saveLesson(made.id, {
        title: title.trim(),
        content: (content ?? EMPTY_DOC) as { type: "doc"; content?: unknown[] },
        videoUrl: null,
        resources: [],
        isPublished: false,
      });
      if (!saved.ok) {
        setErr(saved.message ?? "Opslaan mislukt.");
        return;
      }
      // Door naar de editor om te verfijnen en te publiceren.
      router.push(`/kennisbank/${courseId}?les=${made.id}&bewerk=1`);
    });
  }

  const busy = genPending || createPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] p-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-full bg-[var(--color-brand-600)]/12 text-[var(--color-brand-600)]"><BookPlus className="size-5" /></span>
            <div>
              <h2 className="text-base font-bold tracking-tight">Nieuwe SOP maken</h2>
              <p className="text-xs text-[var(--color-ink-muted)]">Maak een werkinstructie en zet hem in de juiste categorie.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]" aria-label="Sluiten">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="sc-label">Titel van de SOP</label>
            <input className="sc-input" placeholder="Bijv. Nieuwe klant onboarden" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {/* Categorie: cursus + optioneel hoofdstuk. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="sc-label">Categorie (cursus)</label>
              <select className="sc-input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                {courses.length === 0 ? <option value="">Maak eerst een cursus aan…</option> : null}
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="sc-label">Hoofdstuk <span className="font-normal text-[var(--color-ink-faint)]">(optioneel)</span></label>
              <select className="sc-input" value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={chapters.length === 0}>
                <option value="">— Direct onder de cursus —</option>
                {chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>{ch.title}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="sc-label">Waar gaat de SOP over? <span className="font-normal text-[var(--color-ink-faint)]">(voor het AI-concept)</span></label>
            <textarea
              className="sc-input resize-y text-sm leading-relaxed"
              rows={3}
              placeholder="Beschrijf kort de taak of het proces, bijv. 'Hoe we een nieuwe klant toevoegen in het portaal en de eerste opname inplannen.'"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          {/* AI-concept in onze huisstijl. */}
          {aiReady ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={generate} disabled={busy} variant="secondary" size="sm">
                {genPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {content ? "Opnieuw genereren" : "Genereer concept in onze stijl"}
              </Button>
              {content ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-good)]">
                  <Check className="size-3.5" /> Concept klaar — je kunt het zo nog bijschaven.
                </span>
              ) : null}
            </div>
          ) : (
            <p className="rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]/40 px-3 py-2 text-xs text-[#8a5300]">
              Automatisch genereren werkt zodra de AI-sleutel is ingesteld. Je kunt de SOP nu gewoon zelf in de editor schrijven.
            </p>
          )}

          {err ? <ErrorNote>{err}</ErrorNote> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] p-4">
          <span className="text-xs text-[var(--color-ink-faint)]">De SOP wordt als concept aangemaakt; je publiceert hem in de editor.</span>
          <Button onClick={create} disabled={busy || !title.trim() || !courseId}>
            {createPending ? <Loader2 className="size-4 animate-spin" /> : <BookPlus className="size-4" />}
            SOP aanmaken & bewerken
          </Button>
        </div>
      </div>
    </div>
  );
}
