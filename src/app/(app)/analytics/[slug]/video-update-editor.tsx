"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Save, Trash2 } from "lucide-react";
import { deleteClientVideoUpdate, saveClientVideoUpdate } from "@/server/actions/video-updates";
import { Button, ErrorNote, buttonClass } from "@/components/ui";

/**
 * Interne editor voor de persoonlijke maand-videoboodschap aan de klant.
 * Een link (YouTube/Vimeo/Loom wordt ingesloten; andere links worden een knop)
 * plus een korte toelichting. Verschijnt meteen op de resultatenpagina.
 */
export function VideoUpdateEditor({
  clientId,
  period,
  periodLabel,
  initial,
}: {
  clientId: string;
  period: string;
  periodLabel: string;
  initial: { videoUrl: string; note: string | null } | null;
}) {
  const [url, setUrl] = useState(initial?.videoUrl ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await saveClientVideoUpdate({ clientId, period, videoUrl: url, note });
      if (r.ok) { setMsg("Opgeslagen — staat op de resultatenpagina van de klant."); router.refresh(); }
      else setErr(r.message ?? "Opslaan mislukt.");
    });
  }
  function remove() {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await deleteClientVideoUpdate({ clientId, period });
      if (r.ok) { setUrl(""); setNote(""); setMsg("Verwijderd."); router.refresh(); }
      else setErr(r.message ?? "Verwijderen mislukt.");
    });
  }

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
        Een korte, persoonlijke video (±1 min) over de resultaten van <strong className="text-[var(--color-ink)]">{periodLabel}</strong> en wat we verbeteren.
        Plak een link van YouTube, Vimeo of Loom — die wordt direct afspeelbaar op de resultatenpagina van de klant.
      </p>

      <label className="block">
        <span className="sc-label">Videolink</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.loom.com/share/…"
          className="sc-input text-sm"
        />
      </label>

      <label className="mt-3 block">
        <span className="sc-label">Toelichting (optioneel)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Bijv. een korte samenvatting van wat goed ging en waar we komende maand op focussen."
          className="sc-input resize-y text-sm"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={pending || !url.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Opslaan
        </Button>
        {initial ? (
          <button type="button" onClick={remove} disabled={pending} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <Trash2 className="size-4" /> Verwijderen
          </button>
        ) : null}
        {msg ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-good)]"><Check className="size-4" /> {msg}</span> : null}
      </div>
      {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}
