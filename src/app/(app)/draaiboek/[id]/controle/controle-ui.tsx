"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Save, Send, Smartphone } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { approveAndSendDraaiboekAction, generateDraaiboekAction, saveDraaiboekAction } from "@/server/actions/draaiboek";
import type { DraaiboekView } from "@/server/draaiboek/service";
import { PART_LABEL, type DraaiboekContent, type DraaiboekVideo } from "@/server/draaiboek/types";

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const fmtStamp = (iso: string) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const firstName = (n: string | null) => (n ? n.split(" ")[0] : "");
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function StatusBadge({ view }: { view: DraaiboekView }) {
  if (!view.status) return null;
  if (view.status === "verstuurd")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-good-soft,#e5f5ed)] px-3 py-1 text-sm font-semibold text-[var(--color-good)]">
        <CheckCircle2 className="size-4" /> Verstuurd naar {firstName(view.sentToName) || "videograaf"}
        {view.sentAt ? <span className="font-normal text-[var(--color-ink-muted)]">· {fmtStamp(view.sentAt)}</span> : null}
      </span>
    );
  if (view.status === "afgerond" || view.status === "afgerond_open")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-sunken)] px-3 py-1 text-sm font-semibold text-[var(--color-ink)]">
        {view.status === "afgerond" ? "Opname afgerond" : "Afgerond met open punten"}
      </span>
    );
  return <span className="inline-flex items-center rounded-full bg-[var(--color-warn-soft)] px-3 py-1 text-sm font-semibold text-[#8a5300]">Concept, nog niet verstuurd</span>;
}

/** Grote, direct bewerkbare scripttekst. */
function BigText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={Math.max(2, value.split("\n").length + 1)}
      className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 font-[Arial,Helvetica,sans-serif] text-[17px] leading-[1.6] text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none"
    />
  );
}

function HintsField({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <label className="mt-2 block">
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">{label} <span className="font-normal text-[var(--color-ink-faint)]">(één per regel, kort houden)</span></span>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(lines(e.target.value));
        }}
        rows={Math.max(1, text.split("\n").length)}
        className="mt-1 w-full resize-y rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none"
      />
    </label>
  );
}

function VideoEditor({ v, onChange }: { v: DraaiboekVideo; onChange: (v: DraaiboekVideo) => void }) {
  const set = (patch: Partial<DraaiboekVideo>) => onChange({ ...v, ...patch });
  return (
    <section id={`video-${v.key}`} className="scroll-mt-20 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-ink)] text-sm font-bold text-white">{v.nr}</span>
        <input
          value={v.titel}
          onChange={(e) => set({ titel: e.target.value })}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-1 text-xl font-bold text-[var(--color-ink)] hover:border-[var(--color-line)] focus:border-[var(--color-brand-500)] focus:outline-none"
        />
      </div>
      <div className="space-y-6">
        {(["hook", "middenstuk", "cta"] as const).map((k) => (
          <div key={k}>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)]">{PART_LABEL[k]}</h3>
            <BigText value={v[k].tekst} onChange={(tekst) => set({ [k]: { ...v[k], tekst } } as Partial<DraaiboekVideo>)} placeholder="Niet in het script gevonden" />
            <HintsField label="Shotaanwijzingen" value={v[k].aanwijzingen} onChange={(aanwijzingen) => set({ [k]: { ...v[k], aanwijzingen } } as Partial<DraaiboekVideo>)} />
          </div>
        ))}
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)]">B-roll</h3>
          <HintsField label="Benodigde beelden" value={v.broll} onChange={(broll) => set({ broll })} />
        </div>
      </div>
    </section>
  );
}

export function ControleView({ view, videographers }: { view: DraaiboekView; videographers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [content, setContent] = useState<DraaiboekContent | null>(view.content);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"gen" | "save" | "send" | null>(null);
  const defaultTo = view.sentToId ?? view.day.videographerId ?? videographers.find((u) => /^rutger/i.test(u.name))?.id ?? videographers[0]?.id ?? "";
  const [toId, setToId] = useState(defaultTo);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const toName = useMemo(() => videographers.find((u) => u.id === toId)?.name ?? "", [toId, videographers]);

  const run = (kind: "gen" | "save" | "send", fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(kind);
    setMsg(null);
    start(async () => {
      const res = await fn();
      setBusy(null);
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Gelukt." : "Niet gelukt.") });
      if (res.ok) {
        if (kind !== "gen") setDirty(false);
        router.refresh();
      }
    });
  };

  const regenerate = () => {
    setConfirmRegen(false);
    run("gen", async () => {
      const res = await generateDraaiboekAction(view.day.id);
      if (res.ok) setDirty(false);
      return res;
    });
  };

  // Na opnieuw genereren komt nieuwe inhoud van de server binnen.
  const [seenGen, setSeenGen] = useState(view.generatedAt);
  if (view.generatedAt !== seenGen) {
    setSeenGen(view.generatedAt);
    setContent(view.content);
  }

  const update = (v: DraaiboekVideo) => {
    if (!content) return;
    setContent({ ...content, videos: content.videos.map((x) => (x.key === v.key ? v : x)) });
    setDirty(true);
  };

  const day = view.day;
  return (
    <div className="mx-auto max-w-[1100px] pb-24">
      <div className="mb-1 text-xs text-[var(--color-ink-muted)]">
        <Link href={`/scripting?sessie=${day.id}`} className="hover:underline">Scripting</Link> › Draaiboek
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ClientLogo name={day.clientName} logoUrl={day.clientLogo} color={day.clientColor} size={40} />
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-ink)]">Draaiboek {day.clientName}</h1>
            <p className="text-sm text-[var(--color-ink-muted)]">
              Opname {fmtDate(day.scheduledOn)}
              {day.startTime ? `, ${day.startTime.slice(0, 5)}` : ""}
              {view.sourceFileName ? ` · uit ${view.sourceFileName}` : ""}
            </p>
          </div>
        </div>
        <StatusBadge view={view} />
      </div>

      {!content ? (
        <div className="mt-8 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center">
          <p className="text-base text-[var(--color-ink)]">Voor deze opname is nog geen draaiboek gemaakt.</p>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Het draaiboek wordt automatisch opgebouwd uit de script-PDF van deze sessie.</p>
          <button
            type="button"
            disabled={pending}
            onClick={regenerate}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy === "gen" ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy === "gen" ? "Draaiboek maken…" : "Genereer draaiboek"}
          </button>
          {msg && !msg.ok ? <p className="mt-3 text-sm text-[var(--color-bad)]">{msg.text}</p> : null}
        </div>
      ) : (
        <>
          {content.warnings.length ? (
            <div className="mt-5 rounded-[var(--radius-md)] bg-[var(--color-warn-soft)] p-4 text-sm text-[#5c3700]">
              <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Controleer dit</div>
              <ul className="list-disc space-y-0.5 pl-5">{content.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
            <nav className="hidden lg:block">
              <div className="sticky top-20 space-y-1">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">{content.videos.length} video&apos;s</div>
                {content.videos.map((v) => (
                  <a key={v.key} href={`#video-${v.key}`} className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-surface-sunken)] text-xs font-bold">{v.nr}</span>
                    <span className="truncate">{v.titel}</span>
                  </a>
                ))}
              </div>
            </nav>
            <div className="space-y-5">
              {content.videos.map((v) => <VideoEditor key={`${view.generatedAt}-${v.key}`} v={v} onChange={update} />)}
            </div>
          </div>

          {/* Vaste actiebalk onderaan: controleren, opslaan en versturen. */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t lg:left-60 border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm">
                {msg ? <span className={msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}>{msg.text}</span> : dirty ? <span className="text-[var(--color-ink-muted)]">Niet opgeslagen wijzigingen</span> : view.status === "verstuurd" ? (
                  <Link href={`/draaiboek/${day.id}`} className="inline-flex items-center gap-1.5 text-[var(--color-ink-muted)] hover:underline"><Smartphone className="size-4" /> Bekijk zoals de videograaf het ziet</Link>
                ) : null}
              </div>
              <button type="button" disabled={pending} onClick={() => setConfirmRegen(true)} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
                {busy === "gen" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Opnieuw genereren
              </button>
              <button type="button" disabled={pending || !dirty} onClick={() => run("save", () => saveDraaiboekAction(day.id, content))} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-50">
                {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {view.status === "concept" ? "Opslaan als concept" : "Opslaan"}
              </button>
              <select value={toId} onChange={(e) => setToId(e.target.value)} aria-label="Videograaf" className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-sm">
                {videographers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button type="button" disabled={pending || !toId} onClick={() => run("send", () => approveAndSendDraaiboekAction(day.id, content, toId))} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Goedkeuren en versturen naar {firstName(toName)}
              </button>
            </div>
          </div>

          {confirmRegen ? (
            <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setConfirmRegen(false); }}>
              <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
                <h2 className="text-lg font-bold text-[var(--color-ink)]">Draaiboek opnieuw genereren?</h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
                  Het draaiboek wordt opnieuw opgebouwd uit de nieuwste script-PDF. Handmatige aanpassingen in deze controlestap gaan verloren
                  {view.status !== "concept" ? ` en het draaiboek gaat terug naar concept: ${firstName(view.sentToName) || "de videograaf"} ziet het pas weer na opnieuw versturen` : ""}. Voortgang van video&apos;s die gelijk blijven, blijft staan.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmRegen(false)} className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-4 text-sm">Annuleren</button>
                  <button type="button" onClick={regenerate} className="h-10 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-4 text-sm font-semibold text-white">Opnieuw genereren</button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
