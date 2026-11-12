"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, RefreshCw, Save } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { refreshStyleProfile, saveStyleCorrections } from "@/server/actions/content-research";
import type { StyleProfile } from "@/server/content-research/style-core";

export type StylePanelProps = {
  clientId: string;
  canWrite: boolean;
  profile: StyleProfile | null;
  sources: Array<{ name: string; modifiedAt: string | null }>;
  updatedAt: string | null;
  notes: string;
};

function List({ title, items, quote }: { title: string; items: string[]; quote?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{title}</p>
      <ul className="space-y-1 text-sm text-[var(--color-ink)]">
        {items.map((t, i) => (
          <li key={i} className={quote ? "border-l-2 border-[var(--color-line-strong,#d4d4e0)] pl-2" : "list-inside list-disc"}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Het stijlprofiel uit de echte Shortclips-scripts van de klant. Hierop worden
 * nieuwe ideeën geschreven én gekeurd. Het team kan corrigeren wat wel of niet
 * past; die correcties gaan altijd voor.
 */
export function StylePanel({ clientId, canWrite, profile, sources, updatedAt, notes }: StylePanelProps) {
  const router = useRouter();
  const [text, setText] = useState(notes);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      const res = await saveStyleCorrections(clientId, text);
      setMsg(res.ok ? "Opgeslagen. Wordt bij de volgende ronde meegenomen." : res.message ?? "Opslaan mislukt.");
      router.refresh();
    });
  const rebuild = () =>
    start(async () => {
      const res = await refreshStyleProfile(clientId);
      setMsg(res.message ?? (res.ok ? "Bezig met opbouwen." : "Mislukt."));
    });

  return (
    <section className="sc-card space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-ink)]">Stijl van deze klant</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Uit onze eigen scripts in Google Drive. Nieuwe ideeën worden in deze stijl geschreven en erop gekeurd. Captions en eigen posts van de klant tellen niet mee.
          </p>
        </div>
        {canWrite ? (
          <button type="button" onClick={rebuild} disabled={pending} className={buttonClass({ variant: "secondary", size: "sm" })}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Opnieuw uit scripts
          </button>
        ) : null}
      </div>

      {profile ? (
        <div className="space-y-3">
          {profile.samenvatting ? <p className="text-sm text-[var(--color-ink)]">{profile.samenvatting}</p> : null}
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {profile.format ? <p><span className="text-[var(--color-ink-muted)]">Format:</span> {profile.format}</p> : null}
            {profile.aanspreekvorm ? <p><span className="text-[var(--color-ink-muted)]">Aanspreekvorm:</span> {profile.aanspreekvorm}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <List title="Hooks uit onze scripts" items={profile.voorbeeldHooks.slice(0, 8)} quote />
            <div className="space-y-4">
              <List title="Bewezen hooks" items={profile.bewezenHooks} quote />
              <List title="Past niet bij deze klant" items={profile.pastNiet} />
            </div>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink-muted)]">Meer: hookpatronen, middenstuk, CTA, schrijfkenmerken</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <List title="Hookpatronen" items={profile.hookPatronen} />
              <List title="Schrijfkenmerken" items={profile.schrijfkenmerken} />
              {profile.middenstukStijl ? <div><p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Middenstuk</p><p>{profile.middenstukStijl}</p></div> : null}
              <div className="space-y-2">
                {profile.ctaStijl ? <div><p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">CTA</p><p>{profile.ctaStijl}</p></div> : null}
                <List title="CTA's uit onze scripts" items={profile.voorbeeldCtas} quote />
              </div>
              {profile.woordenschat.length ? <List title="Woordenschat" items={[profile.woordenschat.join(", ")]} /> : null}
              <List title="Al behandeld" items={profile.onderwerpen.slice(0, 20)} />
            </div>
          </details>
        </div>
      ) : (
        <p className="rounded-md bg-[var(--color-surface-sunken)] p-3 text-sm text-[var(--color-ink-muted)]">
          Nog geen stijlprofiel. Het wordt bij het volgende onderzoek opgebouwd uit de scripts in Drive. Zonder scripts is de keuring extra streng en komen er minder ideeën door.
        </p>
      )}

      {sources.length > 0 ? (
        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Gelezen scripts{updatedAt ? ` · bijgewerkt ${new Date(updatedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : ""}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <li key={s.name} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">
                <FileText className="size-3" /> {s.name}{s.modifiedAt ? ` (${s.modifiedAt})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <label className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]" htmlFor="style-notes">
          Correcties van het team (gaan altijd voor)
        </label>
        <textarea
          id="style-notes"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canWrite}
          rows={3}
          placeholder={'Bijv. "Nooit beginnen met hallo of een begroeting." of "Hoe-veel-kost-het hooks werken hier het best."'}
          className="w-full rounded-md border border-[var(--color-line)] bg-white p-2 text-sm"
        />
        {canWrite ? (
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={save} disabled={pending || text === notes} className={buttonClass({ variant: "primary", size: "sm" })}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Opslaan
            </button>
            {msg ? <span className="text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
