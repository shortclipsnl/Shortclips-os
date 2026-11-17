"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  addBaselineRowAction,
  addFindingAction,
  approveClientResearchAction,
  correctFindingAction,
  removeAdditionAction,
  removeBaselineRowAction,
  startClientResearchAction,
  type ActionResult,
} from "@/server/actions/client-research";
import { BASELINE_METRICS, PLATFORM_LABEL } from "@/lib/client-research";
import { buttonClass } from "@/components/ui";

const field = "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink-muted)]";
const iconBtn = "inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)] disabled:opacity-50";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.message ?? "Dat is niet gelukt." });
      if (r.ok) {
        onOk?.();
        router.refresh();
      }
    });
  return { pending, msg, run };
}

function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-xs ${msg.ok ? "text-[#1d6b4c]" : "text-[#a3271c]"}`} role="status">{msg.text}</p>;
}

/** Start een onderzoek of hercontrole. */
export function StartResearchButton({ clientId, label, variant = "primary" }: { clientId: string; label: string; variant?: "primary" | "secondary" }) {
  const { pending, msg, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={pending} className={buttonClass({ variant, size: "sm" })} onClick={() => run(() => startClientResearchAction(clientId))}>
        {pending ? "Starten..." : label}
      </button>
      <Message msg={msg} />
    </div>
  );
}

/** Goedkeuren: pas hierna gaat het dossier door naar klantkennis en concurrenten. */
export function ApproveResearchButton({ runId }: { runId: string }) {
  const { pending, msg, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" className={buttonClass({ variant: "primary", size: "sm" })} onClick={() => setConfirm(true)}>
          <Check className="size-3.5" /> Goedkeuren en koppelen
        </button>
        <Message msg={msg} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="max-w-[300px] text-right text-xs text-[var(--color-ink-muted)]">Feiten en het strategieadvies gaan naar de klantkennis. Scripts, captions en het Contentgeheugen gebruiken die daarna automatisch.</p>
      <div className="flex gap-2">
        <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setConfirm(false)}>Annuleren</button>
        <button type="button" disabled={pending} className={buttonClass({ variant: "primary", size: "sm" })} onClick={() => run(() => approveClientResearchAction(runId), () => setConfirm(false))}>
          {pending ? "Koppelen..." : "Ja, goedkeuren"}
        </button>
      </div>
      <Message msg={msg} />
    </div>
  );
}

/** Ververst de pagina zolang het onderzoek loopt, zodat de voortgang vanzelf bijwerkt. */
export function ResearchAutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Correctieknoppen bij één bevinding: tekst aanpassen, verbergen of herstellen. */
export function FindingTools({ runId, findingId, tekst, corrected }: { runId: string; findingId: string; tekst: string; corrected: boolean }) {
  const { pending, msg, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tekst);

  if (editing) {
    return (
      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => correctFindingAction({ runId, findingId, tekst: value }), () => setEditing(false));
        }}
      >
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={900} className={field} aria-label="Verbeterde tekst" />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className={buttonClass({ variant: "primary", size: "sm" })}>{pending ? "Opslaan..." : "Correctie opslaan"}</button>
          <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => { setEditing(false); setValue(tekst); }}>Annuleren</button>
          <Message msg={msg} />
        </div>
      </form>
    );
  }
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      <button type="button" className={iconBtn} title="Corrigeren" aria-label="Bevinding corrigeren" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></button>
      {corrected ? (
        <button type="button" disabled={pending} className={iconBtn} title="Oorspronkelijke tekst terugzetten" aria-label="Correctie terugdraaien" onClick={() => run(() => correctFindingAction({ runId, findingId, herstel: true }))}><RotateCcw className="size-3.5" /></button>
      ) : null}
      <button type="button" disabled={pending} className={iconBtn} title="Klopt niet, verbergen" aria-label="Bevinding verbergen" onClick={() => run(() => correctFindingAction({ runId, findingId, verborgen: true }))}><EyeOff className="size-3.5" /></button>
    </span>
  );
}

/** Verborgen bevinding weer tonen. */
export function RestoreFindingButton({ runId, findingId }: { runId: string; findingId: string }) {
  const { pending, run } = useAction();
  return (
    <button type="button" disabled={pending} className="text-xs font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => run(() => correctFindingAction({ runId, findingId, herstel: true }))}>
      Terugzetten
    </button>
  );
}

/** Aanvulling van het team bij een module. */
export function AddFindingForm({ runId, module, placeholder }: { runId: string; module: string; placeholder: string }) {
  const { pending, msg, run } = useAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!open) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Aanvulling toevoegen
      </button>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addFindingAction({ runId, module, tekst: value }), () => { setValue(""); setOpen(false); });
      }}
    >
      <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} maxLength={900} required className={field} placeholder={placeholder} aria-label="Aanvulling" />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={buttonClass({ variant: "primary", size: "sm" })}>{pending ? "Opslaan..." : "Toevoegen"}</button>
        <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setOpen(false)}>Annuleren</button>
        <Message msg={msg} />
      </div>
    </form>
  );
}

export function RemoveAdditionButton({ runId, additionId }: { runId: string; additionId: string }) {
  const { pending, run } = useAction();
  return (
    <button type="button" disabled={pending} className={iconBtn} title="Aanvulling verwijderen" aria-label="Aanvulling verwijderen" onClick={() => run(() => removeAdditionAction({ runId, additionId }))}>
      <X className="size-3.5" />
    </button>
  );
}

/** Handmatig cijfer toevoegen aan de nulmeting, met verplichte herkomst. */
export function BaselineForm({ runId }: { runId: string }) {
  const { pending, msg, run } = useAction();
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState("volgers");
  if (!open) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Cijfer handmatig toevoegen
      </button>
    );
  }
  return (
    <form
      className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3 sm:grid-cols-2 lg:grid-cols-[150px_1fr_130px_150px]"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const form = e.currentTarget;
        run(
          () => addBaselineRowAction({
            runId,
            platform: String(f.get("platform")),
            metric,
            label: String(f.get("label") ?? ""),
            value: Number(String(f.get("value")).replace(/\./g, "").replace(",", ".")),
            bron: String(f.get("bron")),
            gemetenOp: String(f.get("gemetenOp") ?? ""),
          }),
          () => { form.reset(); setOpen(false); },
        );
      }}
    >
      <select name="platform" className={field} aria-label="Platform" defaultValue="instagram">
        {Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select value={metric} onChange={(e) => setMetric(e.target.value)} className={field} aria-label="Soort cijfer">
        {Object.entries(BASELINE_METRICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input name="value" required inputMode="numeric" pattern="[0-9.,]+" className={field} placeholder="Getal" aria-label="Getal" />
      <input name="gemetenOp" type="date" className={field} aria-label="Meetdatum" />
      {metric === "anders" ? <input name="label" required maxLength={80} className={`${field} sm:col-span-2`} placeholder="Naam van het cijfer, bijv. websitebezoekers per maand" aria-label="Naam van het cijfer" /> : null}
      <input name="bron" required maxLength={200} className={`${field} sm:col-span-2`} placeholder="Herkomst, bijv. screenshot Instagram-statistieken van de klant" aria-label="Herkomst van het cijfer" />
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" disabled={pending} className={buttonClass({ variant: "primary", size: "sm" })}>{pending ? "Opslaan..." : "Cijfer opslaan"}</button>
        <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setOpen(false)}>Annuleren</button>
        <Message msg={msg} />
      </div>
    </form>
  );
}

export function RemoveBaselineButton({ runId, rowId }: { runId: string; rowId: string }) {
  const { pending, run } = useAction();
  return (
    <button type="button" disabled={pending} className={iconBtn} title="Handmatig cijfer verwijderen" aria-label="Handmatig cijfer verwijderen" onClick={() => run(() => removeBaselineRowAction({ runId, rowId }))}>
      <Trash2 className="size-3.5" />
    </button>
  );
}
