"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, RotateCw } from "lucide-react";
import { retryOnboardingStep, saveWelcomeMessageAction } from "@/server/actions/onboarding";
import { Card, CardHeader } from "@/components/ui";

export function RetryButton({ clientId, slug }: { clientId: string; slug: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await retryOnboardingStep(clientId, slug);
            if (!r.ok) setMsg(r.message ?? "Opnieuw mislukt.");
            router.refresh();
          })
        }
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Opnieuw proberen
      </button>
      {msg ? <span className="text-2xs text-[var(--color-bad)]">{msg}</span> : null}
    </span>
  );
}

export function WelcomeMessageBox({ clientId, slug, initial, canEdit }: { clientId: string; slug: string; initial: string; canEdit: boolean }) {
  const [val, setVal] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const dirty = val !== initial;
  return (
    <Card>
      <CardHeader title="Welkomstbericht (concept)" subtitle="Wordt nooit automatisch verstuurd. Kopieer, controleer en verstuur zelf." />
      <textarea
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          setSaved(false);
        }}
        readOnly={!canEdit}
        rows={12}
        className="sc-input w-full resize-y py-2 text-sm leading-relaxed"
        aria-label="Welkomstbericht"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(val);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* klembord niet beschikbaar */
            }
          }}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          <Copy className="size-3.5" /> {copied ? "Gekopieerd" : "Kopiëren voor WhatsApp"}
        </button>
        {canEdit && dirty ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveWelcomeMessageAction(clientId, slug, val);
                if (r.ok) setSaved(true);
              })
            }
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
          </button>
        ) : null}
        {saved ? <span className="self-center text-xs text-[var(--color-good)]">Opgeslagen</span> : null}
      </div>
    </Card>
  );
}
