"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Check, ChevronLeft, ChevronRight, FileText, Folder, FolderOpen, HardDrive, Link2, Loader2, Unlink } from "lucide-react";
import {
  linkScriptingDrivePdf,
  listScriptingDriveSessions,
  unlinkScriptingDrivePdf,
  type DriveSessionsResult,
  type SessionView,
} from "@/server/actions/scripting-drive";

type Loaded = Extract<DriveSessionsResult, { ok: true }>;

function fmtLong(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}
function fmtShortDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Script-PDF uit Google Drive koppelen aan één scriptsessie (opname), in drie
 * stappen: sessiemap kiezen → PDF kiezen (alleen PDF's) → bevestigen. De
 * sessiemappen staan nieuwste eerst, gegroepeerd zoals in Drive (jaarmappen).
 * Een sessie die qua datum bij deze opname past krijgt een label; kies je een
 * PDF uit een sessie met een andere datum, dan volgt eerst een waarschuwing.
 */
export function DriveSessionPicker({ productionDayId }: { productionDayId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function load() {
    setLoading(true);
    setErr(null);
    const res = await listScriptingDriveSessions(productionDayId);
    if (res.ok) setData(res);
    else setErr(res.message);
    setLoading(false);
  }
  useEffect(() => {
    let alive = true;
    void listScriptingDriveSessions(productionDayId).then((res) => {
      if (!alive) return;
      if (res.ok) setData(res);
      else setErr(res.message);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [productionDayId]);

  const sessions = useMemo(() => data?.sessions.filter((s) => s.kind === "sessie") ?? [], [data]);
  const others = useMemo(() => data?.sessions.filter((s) => s.kind === "map") ?? [], [data]);
  const selected = data?.sessions.find((s) => s.id === sessionId) ?? null;
  const selectedPdf = selected?.pdfs.find((p) => p.externalId === pdfId) ?? null;

  // Sessies per bovenliggende map (bijv. "2. SHORT VIDEO SCRIPTS / 2026"), in volgorde.
  const grouped = useMemo(() => {
    const out: Array<{ label: string; items: SessionView[] }> = [];
    for (const s of sessions) {
      const label = s.parentLabel ?? "Drive";
      const last = out.at(-1);
      if (last && last.label === label) last.items.push(s);
      else out.push({ label, items: [s] });
    }
    return out;
  }, [sessions]);

  function openSession(s: SessionView) {
    if (s.pdfs.length === 0) return;
    setSessionId(s.id);
    setPdfId(s.pdfs.length === 1 ? s.pdfs[0]!.externalId : null);
    setMsg(null);
  }

  function link() {
    if (!selectedPdf) return;
    start(async () => {
      const res = await linkScriptingDrivePdf(productionDayId, selectedPdf.externalId);
      if (res.ok) {
        setMsg(res.message ?? "Gekoppeld.");
        setSessionId(null);
        setPdfId(null);
        await load();
        router.refresh();
      } else setErr(res.message ?? "Koppelen mislukt.");
    });
  }

  function unlink() {
    start(async () => {
      const res = await unlinkScriptingDrivePdf(productionDayId);
      if (res.ok) { setMsg(res.message ?? null); await load(); router.refresh(); }
      else setErr(res.message ?? "Ontkoppelen mislukt.");
    });
  }

  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        <HardDrive className="size-3.5" /> Script-PDF uit Google Drive
      </p>

      {loading && !data ? (
        <p className="flex items-center gap-2 py-3 text-xs text-[var(--color-ink-muted)]"><Loader2 className="size-3.5 animate-spin" /> Sessiemappen laden…</p>
      ) : err && !data ? (
        <p className="text-xs text-[var(--color-bad)]">{err}</p>
      ) : data ? (
        <>
          {/* Huidige koppeling */}
          {data.linked ? (
            <div className="mb-3 flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-good)]/40 bg-[var(--color-good-soft)] px-3 py-2">
              <Check className="size-4 shrink-0 text-[var(--color-good)]" strokeWidth={2.5} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[var(--color-ink)]">{data.linked.name}</span>
                <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                  Gekoppeld aan deze opname{data.linked.sessionName ? ` · uit ${data.linked.sessionName}` : ""}
                </span>
              </span>
              {data.linked.url ? (
                <a href={data.linked.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-2xs font-semibold text-[var(--color-brand-600)] hover:underline">
                  Openen <ArrowUpRight className="size-3" />
                </a>
              ) : null}
              {data.canWrite ? (
                <button type="button" onClick={unlink} disabled={pending} className="inline-flex shrink-0 items-center gap-1 text-2xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-bad)] disabled:opacity-50" title="Koppeling verwijderen">
                  <Unlink className="size-3" /> Ontkoppelen
                </button>
              ) : null}
            </div>
          ) : null}
          {msg ? <p className="mb-2 text-2xs font-medium text-[var(--color-good)]">{msg}</p> : null}
          {err ? <p className="mb-2 text-2xs text-[var(--color-bad)]">{err}</p> : null}

          {/* Stappenbalk */}
          <ol className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold">
            {["Sessiemap", "PDF", "Koppelen"].map((label, i) => {
              const step = !selected ? 0 : !selectedPdf ? 1 : 2;
              const active = i === step;
              const done = i < step;
              return (
                <li key={label} className="flex items-center gap-1.5">
                  {i > 0 ? <ChevronRight className="size-3 text-[var(--color-ink-faint)]" /> : null}
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${active ? "bg-[var(--color-brand-600)] text-white" : done ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "text-[var(--color-ink-faint)]"}`}>
                    {i + 1}. {label}
                  </span>
                </li>
              );
            })}
          </ol>

          {!selected ? (
            /* Stap 1: sessiemappen */
            sessions.length === 0 && others.length === 0 ? (
              <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] p-3 text-xs text-[var(--color-ink-muted)]">
                Geen scriptmappen gevonden in de Drive-map van {data.clientName}. Staan de scripts in een map met &quot;script&quot; in de naam?
              </p>
            ) : (
              <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
                {grouped.map((g) => (
                  <div key={g.label}>
                    <p className="mb-1 truncate text-2xs font-semibold text-[var(--color-ink-faint)]" title={g.label}>{g.label}</p>
                    <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)]">
                      {g.items.map((s) => <SessionRow key={s.id} s={s} onOpen={() => openSession(s)} />)}
                    </ul>
                  </div>
                ))}
                {others.length > 0 ? (
                  <div>
                    <button type="button" onClick={() => setShowOther((v) => !v)} className="mb-1 inline-flex items-center gap-1 text-2xs font-semibold text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                      <ChevronRight className={`size-3 transition ${showOther ? "rotate-90" : ""}`} /> Overige mappen zonder sessiemap ({others.length})
                    </button>
                    {showOther ? (
                      <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)]">
                        {others.map((s) => <SessionRow key={s.id} s={s} onOpen={() => openSession(s)} showPath />)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          ) : (
            /* Stap 2 en 3: PDF's in de gekozen sessie + bevestigen */
            <div>
              <div className="mb-2 flex items-center gap-2">
                <button type="button" onClick={() => { setSessionId(null); setPdfId(null); }} className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-2xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]">
                  <ChevronLeft className="size-3.5" /> Alle sessies
                </button>
                <FolderOpen className="size-4 shrink-0 text-[var(--color-brand-600)]" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--color-ink)]">{selected.name}</span>
                {selected.dateLabel ? <span className="shrink-0 text-2xs text-[var(--color-ink-muted)]">{selected.dateLabel}</span> : null}
              </div>
              <ul className="max-h-[240px] divide-y divide-[var(--color-line)] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)]">
                {selected.pdfs.map((p) => {
                  const active = p.externalId === pdfId;
                  const isLinked = data.linked?.externalId === p.externalId;
                  return (
                    <li key={p.externalId} className={active ? "bg-[var(--color-brand-50)]" : ""}>
                      <div className="flex items-center gap-2.5 px-3 py-2">
                        <button type="button" disabled={!data.canWrite} onClick={() => setPdfId(p.externalId)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default" aria-pressed={active}>
                          <span className={`grid size-4 shrink-0 place-items-center rounded-full border-2 ${active ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)]" : "border-[var(--color-line-strong)]"}`}>
                            {active ? <span className="size-1.5 rounded-full bg-white" /> : null}
                          </span>
                          <FileText className="size-4 shrink-0 text-[#c0392b]" strokeWidth={1.75} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-[var(--color-ink)]">{p.name}</span>
                            <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
                              {p.subfolder ? `${p.subfolder} · ` : ""}{fmtShortDate(p.modifiedAt)}{isLinked ? " · nu gekoppeld" : ""}
                            </span>
                          </span>
                        </button>
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noopener noreferrer" title="Bekijk in Google Drive" className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-brand-600)]">
                            <ArrowUpRight className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Stap 3: duidelijk zien wat waaraan gekoppeld wordt */}
              {selectedPdf && data.canWrite ? (
                <div className={`mt-3 rounded-[var(--radius-sm)] border p-3 ${selected.match === "mismatch" ? "border-[var(--color-warn)]/60 bg-[var(--color-warn-soft)]" : "border-[var(--color-brand-200)] bg-[var(--color-surface)]"}`}>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-[var(--color-ink-faint)]">Bestand</dt>
                    <dd className="truncate font-semibold text-[var(--color-ink)]">{selectedPdf.name}</dd>
                    <dt className="text-[var(--color-ink-faint)]">Uit sessie</dt>
                    <dd className="truncate text-[var(--color-ink)]">{selected.name}{selected.dateLabel ? ` (${selected.dateLabel})` : ""}</dd>
                    <dt className="text-[var(--color-ink-faint)]">Koppelen aan</dt>
                    <dd className="truncate font-semibold text-[var(--color-ink)]">{data.clientName} · opname {fmtLong(data.scheduledOn)}</dd>
                  </dl>
                  {selected.match === "mismatch" ? (
                    <p className="mt-2 flex items-start gap-1.5 text-2xs font-medium text-[#8a5300]">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" />
                      Let op: deze sessiemap hoort bij {selected.dateLabel}, de opname is op {fmtLong(data.scheduledOn)}. Controleer of dit de juiste sessie is.
                    </p>
                  ) : null}
                  {data.linked && data.linked.externalId !== selectedPdf.externalId ? (
                    <p className="mt-2 text-2xs text-[var(--color-ink-muted)]">Dit vervangt de huidige koppeling ({data.linked.name}).</p>
                  ) : null}
                  <button type="button" onClick={link} disabled={pending || data.linked?.externalId === selectedPdf.externalId} className="mt-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
                    {data.linked?.externalId === selectedPdf.externalId ? "Al gekoppeld" : selected.match === "mismatch" ? "Toch koppelen" : "Koppel aan deze opname"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function SessionRow({ s, onOpen, showPath }: { s: SessionView; onOpen: () => void; showPath?: boolean }) {
  const empty = s.pdfs.length === 0;
  return (
    <li>
      <button type="button" onClick={onOpen} disabled={empty} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--color-surface-sunken)]/60 disabled:cursor-default disabled:hover:bg-transparent">
        <Folder className={`size-4 shrink-0 ${empty ? "text-[var(--color-ink-faint)]" : "text-[var(--color-brand-600)]"}`} strokeWidth={1.75} fill={empty ? "none" : "currentColor"} fillOpacity={0.12} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-xs font-semibold ${empty ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink)]"}`}>{s.name}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
            {showPath && s.parentLabel ? `${s.parentLabel} · ` : ""}
            {s.dateLabel ?? "Geen datum in mapnaam"}
          </span>
        </span>
        {s.containsLinked ? <span className="shrink-0 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-2xs font-semibold text-[#1d6b4c]">Gekoppeld</span> : null}
        {!s.containsLinked && s.match === "match" ? <span className="shrink-0 rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-2xs font-semibold text-[var(--color-brand-700)]">Past bij opname</span> : null}
        <span className={`shrink-0 text-2xs tabular-nums ${empty ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink-muted)]"}`}>
          {empty ? "nog geen PDF" : `${s.pdfs.length} PDF${s.pdfs.length === 1 ? "" : "'s"}`}
        </span>
        {!empty ? <ChevronRight className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" /> : null}
      </button>
    </li>
  );
}
