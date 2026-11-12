"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, EyeOff, Eye, Loader2 } from "lucide-react";
import { Badge, buttonClass } from "@/components/ui";
import { addCompetitor, setCompetitorActive } from "@/server/actions/content-research";

export type CompetitorView = {
  id: string;
  naam: string;
  url: string | null;
  tiktok: string | null;
  instagram: string | null;
  youtube: string | null;
  notitie: string | null;
  bron: string;
  actief: boolean;
  laatsteObservatie: string | null;
  laatsteObservatieOp: string | null;
};

function profileUrl(platform: "tiktok" | "instagram" | "youtube", handle: string): string {
  if (/^https?:\/\//.test(handle)) return handle;
  const h = handle.replace(/^@/, "");
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  return `https://www.youtube.com/@${h}`;
}

/** Zet losse URL's in een observatie om naar klikbare links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--color-brand-600)] hover:underline">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function CompetitorsPanel({ clientId, competitors, canWrite }: { clientId: string; competitors: CompetitorView[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ naam: "", url: "", tiktok: "", instagram: "", youtube: "", notitie: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const active = competitors.filter((c) => c.actief);
  const off = competitors.filter((c) => !c.actief);

  function submit() {
    start(async () => {
      const res = await addCompetitor({ clientId, ...form });
      setMsg(res.message ?? null);
      if (res.ok) {
        setForm({ naam: "", url: "", tiktok: "", instagram: "", youtube: "", notitie: "" });
        setAdding(false);
      }
      router.refresh();
    });
  }

  function toggle(id: string, actief: boolean) {
    start(async () => {
      await setCompetitorActive(id, actief);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3 text-xs text-[var(--color-ink-muted)]">
        Het wekelijkse onderzoek bekijkt deze bedrijven gericht en stelt zelf nieuwe voor (label <span className="font-medium">AI</span>).
        We gebruiken alleen openbare pagina&apos;s. Weergaven of likes van concurrenten tonen we alleen als ze openbaar op de bron staan: TikTok en Instagram bieden geen toegestane API om statistieken van andere accounts op te halen.
        Zet een bedrijf uit en het wordt niet meer onderzocht of opnieuw voorgesteld.
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--color-ink)]">{active.length} concurrent{active.length === 1 ? "" : "en"} in het onderzoek</p>
        {canWrite ? (
          <button type="button" onClick={() => setAdding((v) => !v)} className={buttonClass({ variant: "secondary", size: "sm" })}>
            <Plus className="size-3.5" /> Concurrent toevoegen
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="sc-card grid gap-2 p-4 sm:grid-cols-2">
          <input className="sc-input text-sm" placeholder="Naam *" value={form.naam} onChange={(e) => setForm({ ...form, naam: e.target.value })} />
          <input className="sc-input text-sm" placeholder="Website" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className="sc-input text-sm" placeholder="TikTok (@handle)" value={form.tiktok} onChange={(e) => setForm({ ...form, tiktok: e.target.value })} />
          <input className="sc-input text-sm" placeholder="Instagram (@handle)" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} />
          <input className="sc-input text-sm" placeholder="YouTube (@kanaal)" value={form.youtube} onChange={(e) => setForm({ ...form, youtube: e.target.value })} />
          <input className="sc-input text-sm" placeholder="Waarom relevant? (optioneel)" value={form.notitie} onChange={(e) => setForm({ ...form, notitie: e.target.value })} />
          <div className="flex items-center gap-2 sm:col-span-2">
            <button type="button" disabled={pending || !form.naam.trim()} onClick={submit} className={buttonClass({ variant: "primary", size: "sm" })}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Toevoegen
            </button>
            <button type="button" onClick={() => setAdding(false)} className={buttonClass({ variant: "ghost", size: "sm" })}>Annuleren</button>
          </div>
        </div>
      ) : null}
      {msg ? <p className="text-xs text-[var(--color-ink-muted)]">{msg}</p> : null}

      {active.length === 0 ? (
        <div className="sc-card p-5 text-sm text-[var(--color-ink-muted)]">
          Nog geen concurrenten. Het volgende onderzoek stelt er automatisch een paar voor; je kunt ze ook zelf toevoegen.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((c) => (
            <div key={c.id} className="sc-card space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
                    {c.naam} <Badge tone={c.bron === "ai" ? "violet" : "neutral"} className="!px-1.5 !py-0 text-2xs">{c.bron === "ai" ? "AI" : "Team"}</Badge>
                  </p>
                  {c.notitie ? <p className="text-xs text-[var(--color-ink-muted)]">{c.notitie}</p> : null}
                </div>
                {canWrite ? (
                  <button type="button" disabled={pending} onClick={() => toggle(c.id, false)} className={buttonClass({ variant: "ghost", size: "sm" })} title="Niet meer onderzoeken">
                    <EyeOff className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">Website <ExternalLink className="size-3" /></a> : null}
                {c.tiktok ? <a href={profileUrl("tiktok", c.tiktok)} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-600)] hover:underline">TikTok</a> : null}
                {c.instagram ? <a href={profileUrl("instagram", c.instagram)} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-600)] hover:underline">Instagram</a> : null}
                {c.youtube ? <a href={profileUrl("youtube", c.youtube)} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-600)] hover:underline">YouTube</a> : null}
              </div>
              {c.laatsteObservatie ? (
                <div className="rounded-md bg-[var(--color-surface-sunken)] p-2 text-xs text-[var(--color-ink-muted)]">
                  <p className="mb-0.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                    Laatste observatie{c.laatsteObservatieOp ? ` · ${new Date(c.laatsteObservatieOp).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : ""}
                  </p>
                  <Linkified text={c.laatsteObservatie} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {off.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-[var(--color-ink-muted)]">Uitgezet ({off.length})</summary>
          <ul className="mt-2 space-y-1">
            {off.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                {c.naam}
                {canWrite ? (
                  <button type="button" disabled={pending} onClick={() => toggle(c.id, true)} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    <Eye className="size-3.5" /> Weer meenemen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
