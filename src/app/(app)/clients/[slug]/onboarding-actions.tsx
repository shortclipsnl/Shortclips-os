"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, RotateCw, Search } from "lucide-react";
import {
  confirmStepAction,
  findFrameProjectAction,
  markWelcomeSentAction,
  retryOnboardingStep,
  saveBriefingAction,
  saveWelcomeMessageAction,
  saveWhatsappLinkAction,
  setKickoffAction,
  setStepDisabledAction,
} from "@/server/actions/onboarding";
import { Button, Card, CardHeader } from "@/components/ui";
import { BRIEFING_FIELDS } from "@/lib/onboarding-plan";

type Ref = { clientId: string; slug: string };
type Result = { ok: boolean; message?: string };

const smallBtn =
  "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-50";
const primaryBtn =
  "inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-50";

/** Kleine actieknop met laden, foutmelding en verversen. */
function ActionButton({ label, run, primary, icon }: { label: string; run: () => Promise<Result>; primary?: boolean; icon?: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await run();
            if (r.message) setMsg({ ok: r.ok, text: r.message });
            router.refresh();
          })
        }
        className={primary ? primaryBtn : smallBtn}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : icon} {label}
      </button>
      {msg ? <span className={`text-2xs ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</span> : null}
    </span>
  );
}

function CopyButton({ text, label = "Kopiëren" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* klembord niet beschikbaar */
        }
      }}
      className={smallBtn}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Gekopieerd" : label}
    </button>
  );
}

export function RetryButton({ clientId, slug }: Ref) {
  return <ActionButton label="Opnieuw proberen" icon={<RotateCw className="size-3.5" />} run={() => retryOnboardingStep(clientId, slug)} />;
}

export function ConfirmStepButton({ clientId, slug, step, label }: Ref & { step: "contract" | "frame"; label: string }) {
  return <ActionButton label={label} run={() => confirmStepAction(clientId, slug, step)} />;
}

export function FindFrameButton({ clientId, slug }: Ref) {
  return <ActionButton label="Nu zoeken in Frame.io" primary icon={<Search className="size-3.5" />} run={() => findFrameProjectAction(clientId, slug)} />;
}

export function WelcomeSentButton({ clientId, slug }: Ref) {
  return <ActionButton label="Verstuurd" primary icon={<Check className="size-3.5" />} run={() => markWelcomeSentAction(clientId, slug)} />;
}

/** WhatsApp: alles voorbereid, de groep maak je zelf; de link sluit de stap af. */
export function WhatsappPanel({ clientId, slug, groupName, members, phone }: Ref & { groupName: string; members: string[]; phone: string | null }) {
  const [link, setLink] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-2 text-xs">
      <ol className="list-decimal space-y-1.5 pl-4 text-[var(--color-ink-muted)]">
        <li>
          Maak in WhatsApp Business een groep met de naam <span className="font-semibold text-[var(--color-ink)]">{groupName}</span> <CopyButton text={groupName} label="Naam kopiëren" />
        </li>
        <li>
          Voeg toe: <span className="text-[var(--color-ink)]">{members.join(", ") || "projectmanager en contactpersoon"}</span>
          {phone ? <span> ({phone})</span> : null}
        </li>
        <li>Plak de groepslink hieronder (Groepsinfo, Uitnodigen via link).</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://chat.whatsapp.com/..." className="sc-input h-8 min-w-[220px] flex-1 py-0 text-xs" aria-label="WhatsApp groepslink" />
        <button
          type="button"
          disabled={pending || !link.trim()}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await saveWhatsappLinkAction(clientId, slug, link);
              if (!r.ok) setErr(r.message ?? "Opslaan mislukt.");
              else router.refresh();
            })
          }
          className={primaryBtn}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Groepslink opslaan
        </button>
      </div>
      {err ? <p className="text-2xs text-[var(--color-bad)]">{err}</p> : null}
    </div>
  );
}

/** Kickoff staat niet in de agenda? Dan handmatig een datum vastleggen. */
export function KickoffPanel({ clientId, slug }: Ref) {
  const [at, setAt] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[var(--color-ink-muted)]">Staat hij niet in de agenda Team Shortclips?</span>
      <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="sc-input h-8 w-auto py-0 text-xs" aria-label="Datum en tijd kickoff" />
      {at ? <ActionButton label="Handmatig vastleggen" run={() => setKickoffAction(clientId, slug, at)} /> : null}
    </div>
  );
}

/** Briefing: één keer invullen, komt in het klantgeheugen. */
export function BriefingForm({ clientId, slug, initial, canEdit }: Ref & { initial: Record<string, string>; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const filled = BRIEFING_FIELDS.filter((f) => initial[f.key]).length;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={filled ? smallBtn : primaryBtn}>
        {filled ? `Briefing bekijken (${filled}/${BRIEFING_FIELDS.length})` : canEdit ? "Briefing invullen" : "Briefing bekijken"}
      </button>
    );
  }
  return (
    <div className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3">
      <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
        Komt in het klantgeheugen. De Scriptgenerator en Content Research gebruiken het automatisch. Doelstellingen en doelgroep zijn verplicht.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {BRIEFING_FIELDS.map((f) => (
          <label key={f.key} className="block text-xs">
            <span className="mb-1 block font-semibold text-[var(--color-ink-muted)]">
              {f.title}
              {f.required ? " *" : ""}
            </span>
            <textarea
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              readOnly={!canEdit}
              rows={3}
              placeholder={f.placeholder}
              className="sc-input w-full resize-y py-2 text-sm"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(null);
                const r = await saveBriefingAction(clientId, slug, vals);
                setMsg(r.ok ? { ok: true, text: "Opgeslagen in het klantgeheugen" } : { ok: false, text: r.message ?? "Opslaan mislukt." });
                if (r.ok) router.refresh();
              })
            }
            className={primaryBtn}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan in klantgeheugen
          </button>
        ) : null}
        <button type="button" onClick={() => setOpen(false)} className={smallBtn}>
          Sluiten
        </button>
        {msg ? <span className={`text-2xs ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</span> : null}
      </div>
    </div>
  );
}

/** Checklist per klant aanpassen: stappen aan- of uitzetten. */
export function ChecklistEditor({ clientId, slug, steps, disableable }: Ref & { steps: { key: string; label: string; required: boolean; off: boolean }[]; disableable: string[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <Card>
      <CardHeader
        title="Checklist aanpassen"
        subtitle="Zet stappen uit die voor deze klant niet nodig zijn. Verplichte stappen kan alleen Jarno uitzetten."
        action={
          <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)}>
            {open ? "Klaar" : "Aanpassen"}
          </Button>
        }
      />
      {open ? (
        <ul className="mt-3 space-y-1.5">
          {steps.map((s) => {
            const can = disableable.includes(s.key);
            return (
              <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
                <span className={s.off ? "text-[var(--color-ink-faint)] line-through" : ""}>
                  {s.label}
                  {s.required ? <span className="ml-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">verplicht</span> : null}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!s.off}
                  aria-label={`${s.label} ${s.off ? "aanzetten" : "uitzetten"}`}
                  disabled={!can || pending}
                  title={can ? undefined : "Verplichte stap"}
                  onClick={() =>
                    start(async () => {
                      setErr(null);
                      const r = await setStepDisabledAction(clientId, slug, s.key, !s.off);
                      if (!r.ok) setErr(r.message ?? "Aanpassen mislukt.");
                      router.refresh();
                    })
                  }
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${s.off ? "bg-[var(--color-line-strong)]" : "bg-[var(--color-good)]"}`}
                >
                  <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${s.off ? "left-0.5" : "left-[18px]"}`} />
                </button>
              </li>
            );
          })}
          {err ? <li className="text-2xs text-[var(--color-bad)]">{err}</li> : null}
        </ul>
      ) : null}
    </Card>
  );
}

export function WelcomeMessageBox({ clientId, slug, initial, canEdit }: { clientId: string; slug: string; initial: string; canEdit: boolean }) {
  const [val, setVal] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const dirty = val !== initial;
  return (
    <Card>
      <CardHeader title="Welkomstbericht (concept)" subtitle="Wordt nooit automatisch verstuurd. Kopieer, controleer en verstuur zelf in de WhatsApp groep." />
      <textarea
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          setSaved(false);
        }}
        readOnly={!canEdit}
        rows={14}
        className="sc-input mt-3 w-full resize-y py-2 text-sm leading-relaxed"
        aria-label="Welkomstbericht"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton text={val} label="Kopiëren voor WhatsApp" />
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
            className={primaryBtn}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
          </button>
        ) : null}
        {saved ? <span className="self-center text-xs text-[var(--color-good)]">Opgeslagen</span> : null}
      </div>
    </Card>
  );
}
