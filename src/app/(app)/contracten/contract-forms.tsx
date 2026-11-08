"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  endContract, handleContractAttention, renewContract, saveContract, setRenewalStatus, undoEnd, updateEndNotes, verifyContract,
} from "@/server/actions/contracts";
import { addDays, endDateFor, DEFAULT_REMINDER_DAYS, REACTIVATION_LABEL, type Reactivation } from "@/lib/contracts";

const field = "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink-muted)]";
const label = "block space-y-1 text-xs text-[var(--color-ink-muted)]";
const primary = "h-9 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 text-sm font-medium text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-60";
const secondary = "h-9 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60";
const ghost = "h-8 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)] disabled:opacity-60";

const DURATIONS = [3, 6, 12];

type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg }: { msg: Msg }) =>
  msg ? <p className={`text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, okText: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? okText : r.message ?? "Er ging iets mis." });
      if (r.ok) { router.refresh(); after?.(); }
    });
  return { pending, msg, run };
}

/** "60, 30, 14" → [60, 30, 14]. Leeg = standaardmomenten (null). */
const parseReminders = (s: string): number[] | null => {
  const list = s.split(/[,\s]+/).filter((x) => x.trim() !== "").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0 && n <= 365);
  return list.length ? list : null;
};

/** Looptijd: 3, 6, 12 of een eigen aantal maanden, met automatische einddatum. */
function TermFields({ start, setStart, months, setMonths, end, setEnd, startRequired }: {
  start: string; setStart: (v: string) => void; months: string; setMonths: (v: string) => void;
  end: string; setEnd: (v: string) => void; startRequired?: boolean;
}) {
  const custom = months !== "" && !DURATIONS.includes(Number(months));
  const [manualEnd, setManualEnd] = useState(false);
  const auto = start && Number(months) > 0 ? endDateFor(start, Number(months)) : "";
  const shownEnd = manualEnd ? end : auto || end;
  const sync = (s: string, m: string) => { if (!manualEnd && s && Number(m) > 0) setEnd(endDateFor(s, Number(m))); };
  return (
    <>
      <label className={label}>Startdatum
        <input type="date" value={start} required={startRequired} onChange={(e) => { setStart(e.target.value); sync(e.target.value, months); }} className={field} />
      </label>
      <label className={label}>Contractduur
        <div className="flex gap-1.5">
          {DURATIONS.map((d) => (
            <button key={d} type="button" onClick={() => { setMonths(String(d)); sync(start, String(d)); }}
              className={`h-9 flex-1 rounded-[var(--radius-sm)] border text-sm ${Number(months) === d ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)]"}`}>
              {d} mnd
            </button>
          ))}
          <input type="number" min={1} max={120} placeholder="Anders" value={custom ? months : ""} onChange={(e) => { setMonths(e.target.value); sync(start, e.target.value); }} className={`${field} w-24`} aria-label="Afwijkend aantal maanden" />
        </div>
      </label>
      <label className={label}>Einddatum {manualEnd || !auto ? "" : "(automatisch)"}
        <input type="date" value={shownEnd} onChange={(e) => { setManualEnd(true); setEnd(e.target.value); }} className={field} />
      </label>
    </>
  );
}

export type ContractFormInitial = {
  contractId: string | null;
  startsOn: string;
  endsOn: string;
  durationMonths: string;
  monthlyValue: string;
  videosPerMonth: string;
  autoRenew: boolean;
  noticePeriodDays: string;
  clientConfirmed: boolean;
  reminderDays: string;
  notes: string;
};

/** Contract vastleggen of corrigeren. Opslaan = gecontroleerd door Jarno. */
export function ContractForm({ clientId, initial, onDone, submitLabel = "Opslaan" }: {
  clientId: string; initial: ContractFormInitial; onDone?: () => void; submitLabel?: string;
}) {
  const { pending, msg, run } = useAction();
  const [start, setStart] = useState(initial.startsOn);
  const [months, setMonths] = useState(initial.durationMonths);
  const [end, setEnd] = useState(initial.endsOn);
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const shownEnd = end || (start && Number(months) > 0 ? endDateFor(start, Number(months)) : "");
      run(() => saveContract({
        clientId, contractId: initial.contractId, startsOn: start, endsOn: shownEnd, durationMonths: months,
        monthlyValue: Number(String(f.get("monthly")).replace(",", ".")), videosPerMonth: String(f.get("videos") ?? ""),
        autoRenew: f.get("autoRenew") === "ja", noticePeriodDays: Number(f.get("notice") || 0),
        clientConfirmed: f.get("confirmed") === "on", reminderDays: parseReminders(String(f.get("reminders") ?? "")),
        notes: String(f.get("notes") ?? ""),
      }), "Opgeslagen.", onDone);
    }}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <TermFields start={start} setStart={setStart} months={months} setMonths={setMonths} end={end} setEnd={setEnd} />
        <label className={label}>Maandbedrag excl. btw
          <input name="monthly" inputMode="decimal" required defaultValue={initial.monthlyValue} className={field} />
        </label>
        <label className={label}>Afname per maand (shorts/ads)
          <input name="videos" type="number" min={0} max={500} defaultValue={initial.videosPerMonth} className={field} />
        </label>
        <label className={label}>Opzegtermijn (dagen)
          <input name="notice" type="number" min={0} max={365} required defaultValue={initial.noticePeriodDays} className={field} />
        </label>
        <label className={label}>Verlengt automatisch
          <select name="autoRenew" defaultValue={initial.autoRenew ? "ja" : "nee"} className={field}><option value="nee">Nee</option><option value="ja">Ja</option></select>
        </label>
        <label className={label}>Herinneringen (dagen vóór beslismoment)
          <input name="reminders" defaultValue={initial.reminderDays} placeholder={DEFAULT_REMINDER_DAYS.join(", ")} className={field} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-[var(--color-ink)]">
          <input name="confirmed" type="checkbox" defaultChecked={initial.clientConfirmed} /> Klant heeft bevestigd door te gaan
        </label>
      </div>
      <label className={label}>Interne notities
        <textarea name="notes" rows={2} defaultValue={initial.notes} className={field} />
      </label>
      <p className="text-xs text-[var(--color-ink-faint)]">Controleer tegen de getekende overeenkomst. Leeg laten wat je niet zeker weet: het systeem vult niets aan.</p>
      <Note msg={msg} />
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>{submitLabel}</button>
        {onDone ? <button type="button" onClick={onDone} className={secondary}>Annuleren</button> : null}
      </div>
    </form>
  );
}

/** Verlengen: nieuwe periode, oude blijft in de historie. */
export function RenewForm({ contractId, currentEnd, monthlyValue, videosPerMonth, autoRenew, noticePeriodDays, onDone }: {
  contractId: string; currentEnd: string | null; monthlyValue: number; videosPerMonth: number | null;
  autoRenew: boolean; noticePeriodDays: number; onDone: () => void;
}) {
  const { pending, msg, run } = useAction();
  const [start, setStart] = useState(currentEnd ? addDays(currentEnd, 1) : "");
  const [months, setMonths] = useState("");
  const [end, setEnd] = useState("");
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => renewContract({
        contractId, startsOn: start, endsOn: end, durationMonths: months,
        monthlyValue: Number(String(f.get("monthly")).replace(",", ".")), videosPerMonth: String(f.get("videos") ?? ""),
        autoRenew: f.get("autoRenew") === "ja", noticePeriodDays: Number(f.get("notice") || 0),
        notes: String(f.get("notes") ?? ""),
      }), "Verlenging vastgelegd.", onDone);
    }}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <TermFields start={start} setStart={setStart} months={months} setMonths={setMonths} end={end} setEnd={setEnd} startRequired />
        <label className={label}>Nieuw maandbedrag excl. btw
          <input name="monthly" inputMode="decimal" required defaultValue={String(monthlyValue)} className={field} />
        </label>
        <label className={label}>Afname per maand
          <input name="videos" type="number" min={0} max={500} defaultValue={videosPerMonth ?? ""} className={field} />
        </label>
        <label className={label}>Opzegtermijn (dagen)
          <input name="notice" type="number" min={0} max={365} required defaultValue={noticePeriodDays} className={field} />
        </label>
        <label className={label}>Verlengt automatisch
          <select name="autoRenew" defaultValue={autoRenew ? "ja" : "nee"} className={field}><option value="nee">Nee</option><option value="ja">Ja</option></select>
        </label>
      </div>
      <label className={label}>Notitie bij deze verlenging
        <textarea name="notes" rows={2} className={field} />
      </label>
      <p className="text-xs text-[var(--color-ink-faint)]">Begint de verlenging vóór de huidige einddatum (tussentijds of met een nieuw bedrag), dan eindigt de huidige periode de dag ervoor.</p>
      <Note msg={msg} />
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>Verlenging vastleggen</button>
        <button type="button" onClick={onDone} className={secondary}>Annuleren</button>
      </div>
    </form>
  );
}

/** Beëindigen: klant stopt per einddatum, blijft tot dan actief. */
export function EndForm({ contractId, currentEnd, onDone }: { contractId: string; currentEnd: string | null; onDone: () => void }) {
  const { pending, msg, run } = useAction();
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => endContract({
        contractId, endsOn: String(f.get("endsOn")), endReason: String(f.get("reason") ?? ""),
        reactivation: (String(f.get("reactivation") ?? "") || null) as Reactivation | null,
      }), "Beëindiging vastgelegd.", onDone);
    }}>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Laatste dag samenwerking
          <input name="endsOn" type="date" required defaultValue={currentEnd ?? ""} className={field} />
        </label>
        <label className={label}>Heractivatie
          <select name="reactivation" defaultValue="" className={field}>
            <option value="">Nog onbekend</option>
            {(Object.keys(REACTIVATION_LABEL) as Reactivation[]).map((k) => <option key={k} value={k}>{REACTIVATION_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      <label className={label}>Reden van beëindiging
        <textarea name="reason" rows={2} className={field} placeholder="Bijv. resultaten wegen niet op tegen de kosten, kiest voor interne creator" />
      </label>
      <Note msg={msg} />
      <div className="flex gap-2">
        <button disabled={pending} className="h-9 rounded-[var(--radius-sm)] bg-[var(--color-bad)] px-4 text-sm font-medium text-white hover:brightness-95 disabled:opacity-60">Beëindiging vastleggen</button>
        <button type="button" onClick={onDone} className={secondary}>Annuleren</button>
      </div>
    </form>
  );
}

/** Reden en heractivatie bijwerken bij een gestopte klant. */
export function EndNotesForm({ contractId, endReason, reactivation }: { contractId: string; endReason: string | null; reactivation: Reactivation | null }) {
  const { pending, msg, run } = useAction();
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => updateEndNotes({ contractId, endReason: String(f.get("reason") ?? ""), reactivation: String(f.get("reactivation") ?? "") || null }), "Opgeslagen.");
    }}>
      <label className={label}>Reden van beëindiging
        <textarea name="reason" rows={2} defaultValue={endReason ?? ""} className={field} />
      </label>
      <label className={label}>Heractivatie
        <select name="reactivation" defaultValue={reactivation ?? ""} className={field}>
          <option value="">Nog onbekend</option>
          {(Object.keys(REACTIVATION_LABEL) as Reactivation[]).map((k) => <option key={k} value={k}>{REACTIVATION_LABEL[k]}</option>)}
        </select>
      </label>
      <Note msg={msg} />
      <button disabled={pending} className={secondary}>Opslaan</button>
    </form>
  );
}

/**
 * De acties bij een lopend contract: één paneel tegelijk open (Verlengen,
 * Bewerken, Beëindigen), plus snelle statusknoppen.
 */
export function ContractActions({ clientId, contract, edit, isEnded, isDiscussing, confirmed, verified, renewed }: {
  clientId: string;
  contract: { id: string; endsOn: string | null; monthlyValue: number; videosPerMonth: number | null; autoRenew: boolean; noticePeriodDays: number } | null;
  edit: ContractFormInitial;
  isEnded: boolean; isDiscussing: boolean; confirmed: boolean; verified: boolean; renewed: boolean;
}) {
  const [open, setOpen] = useState<"verlengen" | "bewerken" | "beeindigen" | null>(null);
  const { pending, msg, run } = useAction();
  const close = () => setOpen(null);
  const tab = (key: "verlengen" | "bewerken" | "beeindigen", text: ReactNode, cls = secondary) => (
    <button type="button" onClick={() => setOpen(open === key ? null : key)} className={`${cls} ${open === key ? "ring-2 ring-[var(--color-indigo-ink)]" : ""}`}>{text}</button>
  );

  if (!contract) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-ink-muted)]">Nog geen contract vastgelegd voor deze klant.</p>
        <ContractForm clientId={clientId} initial={edit} submitLabel="Contract vastleggen" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!isEnded ? tab("verlengen", "Verlengen", primary) : null}
        {tab("bewerken", "Bewerken")}
        {!isEnded && !renewed ? tab("beeindigen", "Beëindigd") : null}
        {!isEnded && !renewed ? (
          <button type="button" disabled={pending} className={`${secondary} ${isDiscussing ? "bg-[var(--color-warn-soft)]" : ""}`}
            onClick={() => run(() => setRenewalStatus({ contractId: contract.id, status: isDiscussing ? "open" : "in_bespreking" }), isDiscussing ? "Status teruggezet." : "Gemarkeerd als in bespreking.")}>
            {isDiscussing ? "In bespreking ✓" : "In bespreking"}
          </button>
        ) : null}
        {!isEnded && !renewed && !confirmed ? (
          <button type="button" disabled={pending} className={ghost}
            onClick={() => run(() => setRenewalStatus({ contractId: contract.id, status: isDiscussing ? "in_bespreking" : "open", clientConfirmed: true }), "Bevestiging vastgelegd. Leg de verlenging vast zodra de nieuwe periode bekend is.")}>
            Klant heeft bevestigd
          </button>
        ) : null}
        {isEnded ? (
          <button type="button" disabled={pending} className={ghost} onClick={() => run(() => undoEnd({ contractId: contract.id }), "Beëindiging teruggedraaid.")}>Toch niet beëindigd</button>
        ) : null}
        {!verified ? (
          <button type="button" disabled={pending} className={ghost} onClick={() => run(() => verifyContract({ contractId: contract.id }), "Gemarkeerd als gecontroleerd.")}>
            <span className="inline-flex items-center gap-1"><Check className="size-3.5" /> Gegevens kloppen</span>
          </button>
        ) : null}
      </div>
      <Note msg={msg} />
      {open === "verlengen" ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-4">
          <RenewForm contractId={contract.id} currentEnd={contract.endsOn} monthlyValue={contract.monthlyValue} videosPerMonth={contract.videosPerMonth}
            autoRenew={contract.autoRenew} noticePeriodDays={contract.noticePeriodDays} onDone={close} />
        </div>
      ) : null}
      {open === "bewerken" ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-4">
          <ContractForm clientId={clientId} initial={edit} onDone={close} />
        </div>
      ) : null}
      {open === "beeindigen" ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-4">
          <EndForm contractId={contract.id} currentEnd={contract.endsOn} onDone={close} />
        </div>
      ) : null}
    </div>
  );
}

/** "Afgehandeld" bij een herinnering: komt pas bij de volgende fase terug. */
export function HandleAttentionButton({ attentionKey, clientId }: { attentionKey: string; clientId: string }) {
  const { pending, msg, run } = useAction();
  if (msg?.ok) return <span className="text-xs text-[var(--color-good)]">Afgehandeld</span>;
  return (
    <button type="button" disabled={pending} title="Verbergen tot het volgende herinneringsmoment"
      onClick={() => run(() => handleContractAttention({ key: attentionKey, clientId }), "Afgehandeld")} className={ghost}>
      {msg && !msg.ok ? msg.text : "Afgehandeld"}
    </button>
  );
}
