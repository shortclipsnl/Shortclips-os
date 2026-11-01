"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Card, ErrorNote } from "@/components/ui";
import { createProject } from "@/server/actions/ai-editor";

export function NewProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <div className="mb-5">
        <Button variant="accent" onClick={() => setOpen(true)}><Plus className="size-4" /> Nieuwe video maken</Button>
      </div>
    );
  }

  return (
    <Card className="mb-5">
      <div className="space-y-3">
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-info)]/25 bg-[var(--color-info-soft)]/60 px-3 py-2.5 text-xs text-[var(--color-ink)]">
          <p className="font-semibold">Zo doe je het in 2 stappen</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[var(--color-ink-muted)]">
            <li>Geef de video een <strong>titel</strong> en plak hieronder het <strong>script</strong> (sterk aanbevolen).</li>
            <li>Klik op <strong>Aanmaken</strong> — op de volgende stap voeg je de <strong>ruwe camerabeelden</strong> toe: uploaden of de <strong>link van de Google Drive-map</strong> plakken. Daarna klik je op “Genereer advertentievideo”.</li>
          </ol>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Titel</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bijv. Het jaarplan, hook 2" className="sc-input w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Script van de advertentie (optioneel, sterk aanbevolen)</span>
          <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={6} placeholder="Plak hier het script van de advertentie. De AI gebruikt het voor de juiste volgorde, de beste take per zin en de spelling in de ondertitels." className="sc-input w-full" />
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex gap-2">
          <Button
            variant="accent"
            disabled={pending}
            onClick={() => start(async () => {
              setError(null);
              const res = await createProject({ title, script });
              if (res.ok) router.push(`/ai-editor/${res.data!.id}`);
              else setError(res.message);
            })}
          >{pending ? "Bezig…" : "Aanmaken en bestanden toevoegen"}</Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
        </div>
      </div>
    </Card>
  );
}
