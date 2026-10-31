"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Music, RotateCcw, Save, Upload, Trash2, Film, SlidersHorizontal } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorNote, InfoNote } from "@/components/ui";
import { acceptProposal, deleteAsset, deleteReference, reanalyzeReference, restoreStyleVersion, saveStyleVersion, setAssetActive } from "@/server/actions/ai-editor";
import type { StyleConfig } from "@/server/ai-editor/style-profile";

type Proposal = { path: string; label: string; current: number; proposed: number; reason: string };
type Props = {
  active: { id: string; version: number; config: StyleConfig };
  versions: Array<{ id: string; version: number; isActive: boolean; note: string | null; createdAt: string; author: string | null }>;
  references: Array<{ id: string; title: string; status: string; error: string | null; measurements: Record<string, unknown> | null; proposal: Proposal[]; fromProject: boolean; createdAt: string }>;
  assets: Array<{ id: string; kind: string; name: string; isActive: boolean; matchProfile: string | null }>;
  provenance: Array<{ field: string; source: string; note: string }>;
};

/** Bewerkbare velden: de waarden die het team in de praktijk wil kunnen bijstellen. */
const FIELDS: Array<{ group: keyof StyleConfig; key: string; label: string; step?: number; type?: "number" | "color" | "bool" }> = [
  { group: "editing", key: "maxPauseS", label: "Pauzes langer dan (s) eruit", step: 0.01 },
  { group: "editing", key: "targetShotS", label: "Doel gem. shotlengte (s)", step: 0.1 },
  { group: "editing", key: "firstCutBeforeS", label: "Eerste cut uiterlijk op (s)", step: 0.1 },
  { group: "zoom", key: "enabled", label: "Zooms", type: "bool" },
  { group: "zoom", key: "pushInTo", label: "Push-in tot (schaal)", step: 0.01 },
  { group: "zoom", key: "punchIn", label: "Punch-in bij jumpcut (schaal)", step: 0.01 },
  { group: "broll", key: "enabled", label: "B-roll invoegen", type: "bool" },
  { group: "captions", key: "enabled", label: "Ondertitels", type: "bool" },
  { group: "captions", key: "sizePx", label: "Ondertitel grootte (px)", step: 1 },
  { group: "captions", key: "centerYPx", label: "Ondertitel hoogte (px vanaf boven)", step: 5 },
  { group: "captions", key: "boxColor", label: "Ondertitel blokkleur", type: "color" },
  { group: "captions", key: "wordsMax", label: "Max. woorden per blok", step: 1 },
  { group: "cards", key: "enabled", label: "UI-kaarten", type: "bool" },
  { group: "cards", key: "pillPrimary", label: "Kaart accentkleur", type: "color" },
  { group: "color", key: "targetLuma", label: "Helderheid (0-255)", step: 1 },
  { group: "color", key: "targetSaturation", label: "Verzadiging", step: 0.01 },
  { group: "color", key: "targetWarmth", label: "Warmte (R-B)", step: 0.5 },
  { group: "audio", key: "targetLufs", label: "Luidheid (LUFS)", step: 0.5 },
  { group: "audio", key: "musicBelowVoiceDb", label: "Muziek onder stem (dB)", step: 1 },
  { group: "audio", key: "music", label: "Muziek", type: "bool" },
  { group: "audio", key: "sfx", label: "Geluidseffecten", type: "bool" },
];

async function upload(kind: "reference" | "asset", file: File, extra: Record<string, string>): Promise<void> {
  const init = await fetch("/api/ai-editor/upload-init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, filename: file.name, mimeType: file.type, size: file.size, ...extra }) });
  const j = (await init.json()) as { id?: string; uploadUrl?: string; headers?: Record<string, string>; error?: string };
  if (!init.ok || !j.uploadUrl) throw new Error(j.error ?? "Upload voorbereiden mislukt.");
  const put = await fetch(j.uploadUrl, { method: "PUT", headers: j.headers, body: file });
  if (!put.ok) throw new Error("Upload mislukt.");
  await fetch("/api/ai-editor/upload-complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id: j.id }) });
}

export function StyleManager(props: Props) {
  const router = useRouter();
  const [cfg, setCfg] = useState<StyleConfig>(props.active.config);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const refInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const lutInput = useRef<HTMLInputElement>(null);
  const [lutProfile, setLutProfile] = useState("slog3");

  function set(group: keyof StyleConfig, key: string, value: unknown) {
    setCfg((c) => ({ ...c, [group]: { ...(c[group] as object), [key]: value } }) as StyleConfig);
    setDirty(true);
  }
  function act(fn: () => Promise<{ ok: boolean; message?: string }>, then?: () => void) {
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.message ?? "Er ging iets mis."); else { then?.(); router.refresh(); }
    });
  }
  async function doUpload(kind: "reference" | "asset", files: FileList | null, extra: Record<string, string> = {}) {
    if (!files?.length) return;
    setError(null);
    setBusy("Uploaden…");
    try { for (const f of Array.from(files)) await upload(kind, f, extra); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); router.refresh(); }
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {busy ? <InfoNote>{busy}</InfoNote> : null}

      <Card>
        <CardHeader title={`Shortclips Ads Style v${props.active.version}`} subtitle="Actief profiel. Opslaan maakt een nieuwe versie." action={<SlidersHorizontal className="size-4 text-[var(--color-ink-faint)]" />} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => {
            const value = (cfg[f.group] as Record<string, unknown>)[f.key];
            return (
              <label key={`${f.group}.${f.key}`} className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">{f.label}</span>
                {f.type === "bool" ? (
                  <select className="sc-input w-full" value={value ? "1" : "0"} onChange={(e) => set(f.group, f.key, e.target.value === "1")}><option value="1">Aan</option><option value="0">Uit</option></select>
                ) : f.type === "color" ? (
                  <div className="flex gap-2"><input type="color" value={String(value)} onChange={(e) => set(f.group, f.key, e.target.value.toUpperCase())} className="h-9 w-12 rounded border border-[var(--color-line)]" /><input className="sc-input flex-1" value={String(value)} onChange={(e) => set(f.group, f.key, e.target.value)} /></div>
                ) : (
                  <input type="number" step={f.step ?? 1} className="sc-input w-full" value={Number(value)} onChange={(e) => set(f.group, f.key, Number(e.target.value))} />
                )}
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input className="sc-input min-w-[240px] flex-1" placeholder="Wat verandert er? (optioneel)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="accent" disabled={!dirty || pending} onClick={() => act(() => saveStyleVersion({ config: cfg, note }), () => { setDirty(false); setNote(""); })}><Save className="size-4" /> Opslaan als nieuwe versie</Button>
          {dirty ? <Button variant="ghost" onClick={() => { setCfg(props.active.config); setDirty(false); }}>Herstellen</Button> : null}
        </div>
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-[var(--color-ink-muted)]">Waar komen deze waarden vandaan?</summary>
          <ul className="mt-2 space-y-1">
            {props.provenance.map((p) => <li key={p.field}><Badge tone={p.source === "gemeten" ? "good" : "violet"}>{p.source}</Badge> <span className="font-medium">{p.field}:</span> <span className="text-[var(--color-ink-muted)]">{p.note}</span></li>)}
          </ul>
        </details>
      </Card>

      <Card>
        <CardHeader title="Referentievideo's" subtitle="Voeg een goed gemonteerde advertentie toe. De AI meet ritme, kleur en audio en stelt voor welke waarden je kunt overnemen. Er verandert niets zonder jouw akkoord." action={<Button size="sm" variant="secondary" onClick={() => refInput.current?.click()}><Upload className="size-4" /> Referentie toevoegen</Button>} />
        <input ref={refInput} type="file" accept="video/*" multiple className="hidden" onChange={(e) => doUpload("reference", e.target.files)} />
        <div className="mt-3 space-y-3">
          {props.references.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">Nog geen referenties toegevoegd.</p> : null}
          {props.references.map((r) => {
            const m = r.measurements;
            const sel = checked[r.id] ?? [];
            return (
              <div key={r.id} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Film className="size-4 text-[var(--color-ink-faint)]" />
                  <span className="text-sm font-medium">{r.title}</span>
                  {r.fromProject ? <Badge tone="info">Uit AI Editor</Badge> : null}
                  <Badge tone={r.status === "analyzed" ? "good" : r.status === "failed" ? "bad" : "info"}>{r.status === "analyzed" ? "Geanalyseerd" : r.status === "failed" ? "Mislukt" : r.status === "uploading" ? "Uploaden" : "In de wachtrij"}</Badge>
                  <span className="ml-auto flex gap-1">
                    <a className="text-xs text-[var(--color-ink-muted)] hover:underline" href={`/api/ai-editor/media?reference=${r.id}`} target="_blank" rel="noreferrer">Bekijk</a>
                    <button className="ml-2 text-xs text-[var(--color-ink-muted)] hover:underline" onClick={() => act(() => reanalyzeReference(r.id))}>Opnieuw meten</button>
                    <button className="ml-2 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" onClick={() => act(() => deleteReference(r.id))} title="Verwijderen"><Trash2 className="size-4" /></button>
                  </span>
                </div>
                {r.error ? <p className="mt-1 text-xs text-[#a3271c]">{r.error}</p> : null}
                {m ? (
                  <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                    {refSummary(m)}
                  </p>
                ) : null}
                {r.proposal.length ? (
                  <div className="mt-2">
                    <p className="mb-1 text-xs font-medium">Voorstel om over te nemen</p>
                    <ul className="space-y-1">
                      {r.proposal.map((p) => (
                        <li key={p.path} className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={sel.includes(p.path)} onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked ? [...sel, p.path] : sel.filter((x) => x !== p.path) }))} />
                          <span className="font-medium">{p.label}</span>
                          <span className="text-[var(--color-ink-muted)]">{p.current} → {p.proposed} · {p.reason}</span>
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" className="mt-2" disabled={!sel.length || pending} onClick={() => act(() => acceptProposal({ referenceId: r.id, paths: sel }))}>Overnemen als nieuwe versie</Button>
                  </div>
                ) : r.status === "analyzed" ? <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Komt overeen met het huidige profiel; geen voorstel.</p> : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Muziek en LUT's" subtitle="Muziek: de nieuwste actieve track wordt onder de stem gezet. LUT's: technische conversie per camera-logprofiel (bijv. S-Log3 → Rec.709)." />
        <div className="mt-3 flex flex-wrap gap-2">
          <input ref={musicInput} type="file" accept="audio/*" className="hidden" onChange={(e) => doUpload("asset", e.target.files, { assetKind: "music" })} />
          <Button size="sm" variant="secondary" onClick={() => musicInput.current?.click()}><Music className="size-4" /> Muziek toevoegen</Button>
          <select className="sc-input h-8 !w-auto text-xs" value={lutProfile} onChange={(e) => setLutProfile(e.target.value)}>
            {["slog3", "slog2", "vlog", "clog3", "clog", "flog2", "flog", "nlog", "applelog", "logc", "hlg", "default"].map((p) => <option key={p} value={p}>{p === "default" ? "Alle log-profielen" : p}</option>)}
          </select>
          <input ref={lutInput} type="file" accept=".cube" className="hidden" onChange={(e) => doUpload("asset", e.target.files, { assetKind: "lut", matchProfile: lutProfile })} />
          <Button size="sm" variant="secondary" onClick={() => lutInput.current?.click()}><Upload className="size-4" /> LUT (.cube) toevoegen</Button>
        </div>
        <ul className="mt-3 divide-y divide-[var(--color-line)] text-sm">
          {props.assets.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2">
              <Badge tone={a.kind === "music" ? "info" : "violet"}>{a.kind === "music" ? "Muziek" : `LUT ${a.matchProfile ?? ""}`}</Badge>
              <span className="flex-1 truncate">{a.name}</span>
              <select className="sc-input h-8 !w-auto text-xs" value={a.isActive ? "1" : "0"} onChange={(e) => act(() => setAssetActive({ id: a.id, active: e.target.value === "1" }))}><option value="1">Actief</option><option value="0">Uit</option></select>
              <button className="text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" onClick={() => act(() => deleteAsset(a.id))} title="Verwijderen"><Trash2 className="size-4" /></button>
            </li>
          ))}
          {!props.assets.length ? <li className="py-2 text-[var(--color-ink-muted)]">Nog geen muziek of LUT&apos;s. Zonder muziek blijft het muziekbed weg; zonder LUT gebruikt de editor bij log-beelden een generieke conversie.</li> : null}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Versies" action={<History className="size-4 text-[var(--color-ink-faint)]" />} />
        <ul className="mt-3 divide-y divide-[var(--color-line)] text-sm">
          {props.versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2">
              <span className="w-10 font-medium">v{v.version}</span>
              {v.isActive ? <Badge tone="good">Actief</Badge> : null}
              <span className="flex-1 text-xs text-[var(--color-ink-muted)]">{v.note ?? ""} · {v.author ?? "systeem"} · {new Date(v.createdAt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}</span>
              {!v.isActive ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => restoreStyleVersion(v.id))}><RotateCcw className="size-3.5" /> Herstel</Button> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function refSummary(m: Record<string, unknown>): string {
  const n = (k: string, d = 1) => (typeof m[k] === "number" ? (m[k] as number).toFixed(d).replace(".", ",") : "-");
  const color = (m.color ?? null) as { luma?: number } | null;
  return `${n("durationS")} s · ${n("cuts", 0)} cuts · gem. shot ${n("avgShotS", 2)} s · eerste cut ${n("firstCutS")} s · ${n("wpm", 0)} wpm · max pauze ${n("maxPauseS", 2)} s · ${n("lufs")} LUFS · ${typeof m.musicBelowVoiceDb === "number" && m.musicBelowVoiceDb > 3 ? `muziek ~${n("musicBelowVoiceDb", 0)} dB onder stem · ` : ""}helderheid ${color?.luma ?? "-"}`;
}
