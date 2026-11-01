import { BookOpen } from "lucide-react";
import { AI_EDITOR_GUIDE, AI_EDITOR_GUIDE_TITLE } from "@/lib/ai-editor-guide";

/** Uitklapbare teamhandleiding (zelfde inhoud als het kennisbankartikel). */
export function AiEditorGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
        <BookOpen className="size-4 text-[var(--color-brand-500)]" />
        Hoe werkt het? <span className="font-normal text-[var(--color-ink-muted)]">{AI_EDITOR_GUIDE_TITLE}</span>
        <span className="ml-auto text-2xs font-normal text-[var(--color-ink-faint)] group-open:hidden">Uitklappen</span>
        <span className="ml-auto hidden text-2xs font-normal text-[var(--color-ink-faint)] group-open:inline">Inklappen</span>
      </summary>
      <div className="mt-3 space-y-4 text-sm text-[var(--color-ink-muted)]">
        {AI_EDITOR_GUIDE.map((s) => (
          <section key={s.title}>
            <h3 className="mb-1 text-sm font-semibold text-[var(--color-ink)]">{s.title}</h3>
            {s.paragraphs?.map((p, i) => <p key={i} className="mb-1.5">{p}</p>)}
            {s.bullets ? <ul className="list-disc space-y-1 pl-5">{s.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
            {s.examples ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.examples.map((e) => <code key={e} className="rounded bg-[var(--color-surface-sunken)] px-2 py-0.5 text-xs text-[var(--color-ink)]">{e}</code>)}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </details>
  );
}
