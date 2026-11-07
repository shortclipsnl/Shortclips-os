"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerClientFeedback, resolveClientFeedback, saveContractTerms } from "@/server/actions/client-retention";
import {
  FEEDBACK_CATEGORY_LABEL, FEEDBACK_KIND_LABEL, FEEDBACK_SOURCES, FEEDBACK_SOURCE_LABEL, suggestFeedback,
  type FeedbackCategory, type FeedbackKind,
} from "@/lib/client-retention";

const field = "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink-muted)]";
const label = "block space-y-1 text-xs text-[var(--color-ink-muted)]";
const primary = "h-9 rounded-[var(--radius-sm)] bg-[var(--color-violet)] px-4 text-sm font-medium text-white hover:brightness-95 disabled:opacity-60";

/**
 * Feedback registreren. Terwijl je typt doet het systeem een voorstel voor de
 * soort en het onderwerp (op basis van herkenbare formuleringen); jij beslist.
 */
export function FeedbackForm({ clientId, team }: { clientId: string; team: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<FeedbackKind | "">("");
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const suggestion = useMemo(() => (text.trim().length > 8 ? suggestFeedback(text) : null), [text]);
  const k = kind || suggestion?.kind || "aandacht";
  const c = category || suggestion?.category || "kwaliteit";

  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const form = e.currentTarget;
      start(async () => {
        const r = await registerClientFeedback({
          clientId, source: String(f.get("source")) as never, kind: k, category: c,
          summary: String(f.get("summary")), quote: text, followUp: String(f.get("followUp")),
          dueOn: String(f.get("dueOn") ?? ""), ownerId: String(f.get("ownerId") ?? ""),
        });
        setMsg({ ok: r.ok, text: r.ok ? (k === "ernstig" ? "Geregistreerd. De verantwoordelijke heeft direct een melding gekregen." : "Geregistreerd en op Aandachtspunten gezet.") : r.message ?? "Opslaan mislukt." });
        if (r.ok) { form.reset(); setText(""); setKind(""); setCategory(""); router.refresh(); }
      });
    }}>
      <label className={label}>Wat zei de klant? (letterlijk, optioneel)
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={field} placeholder="Plak hier het bericht of de opmerking" />
      </label>
      {suggestion && suggestion.matched.length ? (
        <p className="text-xs text-[var(--color-ink-muted)]">Voorstel: <strong className="text-[var(--color-ink)]">{FEEDBACK_KIND_LABEL[suggestion.kind]}</strong>, {FEEDBACK_CATEGORY_LABEL[suggestion.category].toLowerCase()} (herkend: &ldquo;{suggestion.matched.join("\", \"")}&rdquo;). Controleer dit zelf.</p>
      ) : suggestion ? <p className="text-xs text-[var(--color-ink-muted)]">Geen signaal van ontevredenheid herkend. Is het een normale correctie, dan hoef je niets te registreren.</p> : null}
      <label className={label}>Samenvatting<input name="summary" required maxLength={240} className={field} placeholder="Bijv. klant vindt de montage te rommelig" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Soort
          <select value={k} onChange={(e) => setKind(e.target.value as FeedbackKind)} className={field}>
            <option value="aandacht">{FEEDBACK_KIND_LABEL.aandacht}</option>
            <option value="ernstig">{FEEDBACK_KIND_LABEL.ernstig}</option>
            <option value="correctie">{FEEDBACK_KIND_LABEL.correctie}</option>
          </select>
        </label>
        <label className={label}>Onderwerp
          <select value={c} onChange={(e) => setCategory(e.target.value as FeedbackCategory)} className={field}>
            {(Object.keys(FEEDBACK_CATEGORY_LABEL) as FeedbackCategory[]).map((x) => <option key={x} value={x}>{FEEDBACK_CATEGORY_LABEL[x]}</option>)}
          </select>
        </label>
        <label className={label}>Bron
          <select name="source" defaultValue="whatsapp" className={field}>
            {FEEDBACK_SOURCES.map((s) => <option key={s} value={s}>{FEEDBACK_SOURCE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className={label}>Deadline
          <input name="dueOn" type="date" className={field} title="Leeg = automatisch (ernstig: 1 werkdag, anders 2)" />
        </label>
      </div>
      <label className={label}>Vervolgactie<input name="followUp" required maxLength={500} className={field} placeholder="Bijv. vandaag bellen en verbeterplan bespreken" /></label>
      <label className={label}>Verantwoordelijke
        <select name="ownerId" defaultValue="" className={field}>
          <option value="">Automatisch (verantwoordelijke klant; techniek naar Rutger)</option>
          {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {k === "correctie" ? <p className="text-xs text-[var(--color-ink-muted)]">Normale correcties worden niet geregistreerd.</p> : null}
      {msg ? <p className={`text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}
      <button disabled={pending || k === "correctie"} className={primary}>Registreren</button>
    </form>
  );
}

/** Afronden op de klantpagina: wat is er gedaan? */
export function ResolveFeedbackButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-medium text-[var(--color-violet)]">Afronden</button>;
  return (
    <div className="mt-2 space-y-2">
      <input value={v} onChange={(e) => setV(e.target.value)} className={field} placeholder="Wat is er gedaan? Bijv. klant gebeld, nieuwe versie goedgekeurd" autoFocus />
      {err ? <p className="text-xs text-[var(--color-bad)]">{err}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => start(async () => {
          const r = await resolveClientFeedback({ id, resolution: v });
          if (r.ok) { setOpen(false); router.refresh(); } else setErr(r.message ?? "Afronden mislukt.");
        })} className={primary}>Opgelost</button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-sm">Annuleren</button>
      </div>
    </div>
  );
}

/** Contractvoorwaarden vastleggen en als gecontroleerd markeren. */
export function ContractTermsForm({ clientId, initial }: { clientId: string; initial: { startsOn: string; endsOn: string; noticePeriodDays: string; autoRenew: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="space-y-3 border-t border-[var(--color-line)] pt-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      start(async () => {
        const r = await saveContractTerms({
          clientId, startsOn: String(f.get("startsOn")), endsOn: String(f.get("endsOn") ?? ""),
          noticePeriodDays: Number(f.get("notice")), autoRenew: f.get("autoRenew") === "ja",
        });
        setMsg({ ok: r.ok, text: r.ok ? "Opgeslagen en gemarkeerd als gecontroleerd." : r.message ?? "Opslaan mislukt." });
        if (r.ok) router.refresh();
      });
    }}>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Startdatum<input name="startsOn" type="date" required defaultValue={initial.startsOn} className={field} /></label>
        <label className={label}>Einddatum<input name="endsOn" type="date" defaultValue={initial.endsOn} className={field} /></label>
        <label className={label}>Opzegtermijn (dagen)<input name="notice" type="number" min={0} max={365} required defaultValue={initial.noticePeriodDays} className={field} /></label>
        <label className={label}>Verlengt automatisch
          <select name="autoRenew" defaultValue={initial.autoRenew ? "ja" : "nee"} className={field}><option value="nee">Nee</option><option value="ja">Ja</option></select>
        </label>
      </div>
      <p className="text-xs text-[var(--color-ink-faint)]">Controleer dit tegen de getekende overeenkomst (PandaDoc). Opslaan markeert de gegevens als gecontroleerd.</p>
      {msg ? <p className={`text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}
      <button disabled={pending} className={primary}>Opslaan als gecontroleerd</button>
    </form>
  );
}
