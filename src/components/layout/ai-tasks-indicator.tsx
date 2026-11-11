"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2 } from "lucide-react";
import { fetchActiveAiTasks } from "@/server/actions/ai-tasks";
import type { ActiveAiTask, ActiveAiTasks } from "@/server/ai-tasks";

const POLL_MS = 15_000;

const KIND_LABEL: Record<ActiveAiTask["kind"], string> = {
  content_research: "Content Research",
  video_intelligence: "Video-analyse",
  captions: "Captions",
  maandrapport: "Maandrapportage",
  ai_editor: "AI-editor",
};

function since(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "net gestart";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min bezig`;
  return `${Math.floor(m / 60)} u bezig`;
}

/**
 * Uniforme indicator van de AI-taken die NU op de achtergrond draaien (Content
 * Research, Video-analyse, Captions, Maandrapportages, AI-editor). De taken
 * draaien server-side door — ook als je de pagina sluit; deze chip laat zien wat
 * er loopt en verdwijnt zodra alles klaar is. Afrondmeldingen komen via de bel.
 */
export function AiTasksIndicator({ initial }: { initial: ActiveAiTasks }) {
  const [data, setData] = useState<ActiveAiTasks>(initial);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const next = await fetchActiveAiTasks();
      setData(next);
    } catch {
      /* stil: netwerkhik — volgende poll probeert opnieuw */
    }
  }, []);

  useEffect(() => {
    timer.current = setInterval(refresh, POLL_MS);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  // Niets te doen zodra er geen AI-taak meer loopt.
  if (data.count === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${data.count} AI-taak${data.count === 1 ? "" : "en"} bezig`}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-brand-700)] transition hover:border-[var(--color-brand-400)]"
      >
        <span className="relative grid size-4 place-items-center">
          <Sparkles className="size-4" />
          <span className="absolute -right-1 -top-1 size-2 animate-ping rounded-full bg-[var(--color-brand-500)]" />
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-[var(--color-brand-500)]" />
        </span>
        AI bezig
        <span className="rounded-full bg-[var(--color-brand-600)] px-1.5 text-2xs tabular-nums text-white">{data.count}</span>
      </button>

      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[85vw] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
              <Sparkles className="size-4 text-[var(--color-brand-600)]" />
              <span className="text-sm font-semibold text-[var(--color-ink)]">AI-taken op de achtergrond</span>
              <span className="ml-auto text-2xs text-[var(--color-ink-faint)]">{data.count} bezig</span>
            </div>
            <ul className="max-h-[60vh] divide-y divide-[var(--color-line)] overflow-y-auto">
              {data.items.map((t, i) => (
                <li key={`${t.kind}-${i}`}>
                  <Link href={t.href} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-sunken)]">
                    <Loader2 className="size-4 shrink-0 animate-spin text-[var(--color-brand-500)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--color-ink)]">{KIND_LABEL[t.kind]}</span>
                      {t.sub ? <span className="block truncate text-xs text-[var(--color-ink-muted)]">{t.sub}</span> : null}
                    </span>
                    <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">{since(t.startedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="border-t border-[var(--color-line)] px-4 py-2 text-2xs text-[var(--color-ink-faint)]">
              Deze taken draaien server-side door, ook als je de pagina of browser sluit — je hoeft niet te wachten.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
