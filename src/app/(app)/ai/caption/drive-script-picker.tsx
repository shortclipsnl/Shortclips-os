"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, ExternalLink, FileText, Folder, HardDrive, Loader2, RefreshCw, X } from "lucide-react";
import {
  listShootDriveScripts,
  regenerateShootCaptions,
  setShootDriveScript,
  type DriveScriptListResult,
} from "@/server/actions/captions";

type Candidate = Extract<DriveScriptListResult, { ok: true }>["candidates"][number];

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Leidt de sessie-map af uit het Drive-pad. Het pad bevat het bestand als laatste
 * segment (…/Sessie/script.pdf), dus de sessie is de map eromheen. Zo groeperen we
 * de PDF's per opname/sessie in plaats van één lange, onleesbare lijst.
 */
function sessionOf(path: string | null): { key: string; label: string } {
  if (!path) return { key: "__overig__", label: "Overig" };
  const idx = path.lastIndexOf("/");
  const dir = idx > 0 ? path.slice(0, idx) : "";
  const segs = dir.split("/").filter(Boolean);
  const label = segs.length ? segs[segs.length - 1]! : "Overig";
  return { key: dir || "__root__", label };
}

/**
 * Handmatig de juiste script-PDF uit Google Drive kiezen voor een opname — en
 * 'm opnieuw ophalen als er een nieuwere versie in Drive staat. Opent een paneel
 * met de script-PDF's van de klant (nieuwste eerst); één klik koppelt 'm en laat
 * de captions op basis van dát script (opnieuw) genereren. Zo horen de captions
 * altijd bij het juiste, meest actuele script.
 */
export function DriveScriptPicker({
  productionDayId,
  variant = "button",
  hasCoupledSource = false,
}: {
  productionDayId: string;
  variant?: "button" | "chip";
  hasCoupledSource?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  function toggleFolder(key: string) {
    setOpenFolders((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  // PDF's groeperen per sessie-map (nieuwste map eerst; binnen een map nieuwste PDF eerst).
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; files: Candidate[]; newest: string | null; hasCurrent: boolean }>();
    for (const c of candidates) {
      const { key, label } = sessionOf(c.path);
      let g = map.get(key);
      if (!g) { g = { key, label, files: [], newest: null, hasCurrent: false }; map.set(key, g); }
      g.files.push(c);
      if (c.modifiedAt && (!g.newest || c.modifiedAt > g.newest)) g.newest = c.modifiedAt;
      if (c.externalId === current) g.hasCurrent = true;
    }
    const arr = [...map.values()];
    for (const g of arr) g.files.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
    arr.sort((a, b) => (b.newest ?? "").localeCompare(a.newest ?? ""));
    return arr;
  }, [candidates, current]);

  // Handig startpunt: de map met het huidige script staat open; is er maar één map,
  // dan die. De rest blijft dicht zodat het overzicht scanbaar is.
  useEffect(() => {
    if (groups.length === 0) { setOpenFolders(new Set()); return; }
    const toOpen = new Set<string>();
    const cur = groups.find((g) => g.hasCurrent);
    if (cur) toOpen.add(cur.key);
    else if (groups.length === 1) toOpen.add(groups[0]!.key);
    setOpenFolders(toOpen);
  }, [groups]);

  async function load() {
    setLoading(true);
    setErr(null);
    const res = await listShootDriveScripts(productionDayId);
    if (res.ok) {
      setCandidates(res.candidates);
      setCurrent(res.currentFileExternalId);
    } else {
      setErr(res.message);
    }
    setLoading(false);
  }

  function openPicker() {
    setOpen(true);
    void load();
  }

  function choose(fileExternalId: string) {
    setBusyId(fileExternalId);
    setErr(null);
    start(async () => {
      const res = await setShootDriveScript(productionDayId, fileExternalId);
      setBusyId(null);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setErr(res.message ?? "Koppelen mislukt.");
      }
    });
  }

  function refreshFromDrive() {
    setErr(null);
    start(async () => {
      const res = await regenerateShootCaptions(productionDayId);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setErr(res.message ?? "Opnieuw ophalen mislukt.");
      }
    });
  }

  return (
    <>
      {variant === "chip" ? (
        <button
          type="button"
          onClick={openPicker}
          title="Script uit Google Drive kiezen of opnieuw ophalen"
          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-2xs font-medium text-[#0060a8] hover:brightness-95"
        >
          <HardDrive className="size-3" /> Script uit Drive
        </button>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          title="Script uit Google Drive kiezen"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          <HardDrive className="size-3.5 text-[var(--color-brand-600)]" /> Script uit Drive
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 sm:p-8"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
            <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <HardDrive className="size-4 text-[var(--color-brand-600)]" />
              <h2 className="text-sm font-semibold">Script uit Google Drive kiezen</h2>
              {hasCoupledSource ? (
                <button
                  type="button"
                  onClick={refreshFromDrive}
                  disabled={pending}
                  title="Haal de laatste versie van het gekoppelde script opnieuw op uit Drive en werk de captions bij"
                  className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Opnieuw uit Drive
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} className={`${hasCoupledSource ? "" : "ml-auto"} shrink-0 rounded p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]`}>
                <X className="size-5" />
              </button>
            </div>

            <div className="p-4">
              <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                Kies eerst de <strong>sessie-map</strong> en daarna de juiste script-PDF. De captions worden meteen op
                basis van dat script (opnieuw) gemaakt. Staat er later een nieuwe versie in Drive? Klik dan op <strong>Opnieuw uit Drive</strong>.
              </p>

              {loading ? (
                <p className="flex items-center gap-2 py-6 text-sm text-[var(--color-ink-muted)]">
                  <Loader2 className="size-4 animate-spin" /> Script-PDF&apos;s uit Drive laden…
                </p>
              ) : candidates.length === 0 ? (
                <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
                  Geen script-PDF&apos;s in de Drive-map van deze klant gevonden. Controleer of de map gesynchroniseerd is
                  en of het bestand een PDF in een &ldquo;Scripts&rdquo;-map is.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {groups.map((g) => {
                    const isOpen = openFolders.has(g.key);
                    return (
                      <div key={g.key} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
                        {/* Sessie-map: klik om de PDF's eronder te tonen/verbergen. */}
                        <button
                          type="button"
                          onClick={() => toggleFolder(g.key)}
                          aria-expanded={isOpen}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-sunken)]"
                        >
                          {isOpen ? <ChevronDown className="size-4 shrink-0 text-[var(--color-ink-faint)]" /> : <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />}
                          <Folder className="size-4 shrink-0 text-[var(--color-brand-600)]" />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-ink)]">{g.label}</span>
                          {g.hasCurrent ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-2xs font-semibold text-[#1d6b4c]">
                              <Check className="size-3" /> in gebruik
                            </span>
                          ) : null}
                          <span className="shrink-0 text-2xs tabular-nums text-[var(--color-ink-faint)]">
                            {g.files.length} PDF{g.files.length === 1 ? "" : "'s"}{g.newest ? ` · ${fmtDate(g.newest)}` : ""}
                          </span>
                        </button>
                        {isOpen ? (
                          <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
                            {g.files.map((c) => {
                              const isCurrent = c.externalId === current;
                              const isBusy = busyId === c.externalId;
                              return (
                                <li
                                  key={c.externalId}
                                  className={`flex items-center gap-2.5 px-3 py-2 ${isCurrent ? "bg-[var(--color-brand-50)]" : "bg-[var(--color-surface)]"}`}
                                >
                                  <FileText className="size-4 shrink-0 text-[var(--color-brand-600)]" strokeWidth={1.75} />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-[var(--color-ink)]">{c.name}</p>
                                    <p className="truncate text-2xs text-[var(--color-ink-faint)]">
                                      {c.modifiedAt ? `gewijzigd ${fmtDate(c.modifiedAt)}` : "datum onbekend"}
                                    </p>
                                  </div>
                                  {c.url ? (
                                    <a
                                      href={c.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Openen in Google Drive"
                                      className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                                    >
                                      <ExternalLink className="size-3.5" />
                                    </a>
                                  ) : null}
                                  {isCurrent ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-2xs font-semibold text-[#1d6b4c]">
                                      <Check className="size-3" /> In gebruik
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={pending}
                                      onClick={() => choose(c.externalId)}
                                      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
                                    >
                                      {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                                      Gebruik voor captions
                                    </button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {err ? <p className="mt-3 text-xs font-medium text-[var(--color-bad)]">{err}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
