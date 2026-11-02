"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FolderCheck, Loader2, MessageSquarePlus, Plus, Sparkles, Wand2 } from "lucide-react";
import { Button, Card, ErrorNote } from "@/components/ui";
import { VoiceButton } from "@/app/(app)/ai/_shared";
import { checkDriveFolder, createProjectFromIntake, intakeOpnameDetail, intakeOpnames } from "@/server/actions/ai-editor";
import type { IntakeClient, IntakeOpname, OpnameDetail } from "@/server/ai-editor/intake";

type DriveState = { state: "idle" | "checking" | "ok" | "err"; count?: number; msg?: string; auto?: boolean };

const STATUS_LABEL: Record<string, string> = { idea: "Idee", concept: "Concept", review: "Ter review", approved: "Goedgekeurd", final: "Definitief" };

function initials(n: string) { return n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }
function fmtDate(d: string) { try { return new Date(d + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }); } catch { return d; } }

export function NewProject({ clients, driveConfigured }: { clients: IntakeClient[]; driveConfigured: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="mb-5">
        <Button variant="accent" onClick={() => setOpen(true)}><Plus className="size-4" /> Nieuwe video aanleveren</Button>
      </div>
    );
  }
  return <Intake clients={clients} driveConfigured={driveConfigured} onClose={() => setOpen(false)} router={router} />;
}

function Intake({ clients, driveConfigured, onClose, router }: {
  clients: IntakeClient[]; driveConfigured: boolean; onClose: () => void; router: ReturnType<typeof useRouter>;
}) {
  const [client, setClient] = useState<IntakeClient | null>(null);
  const [opnames, setOpnames] = useState<IntakeOpname[]>([]);
  const [loadingOpnames, setLoadingOpnames] = useState(false);
  const [opname, setOpname] = useState<IntakeOpname | null>(null);
  const [detail, setDetail] = useState<OpnameDetail | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [driveLink, setDriveLink] = useState("");
  const [drive, setDrive] = useState<DriveState>({ state: "idle" });
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [checking, setChecking] = useState(false);

  async function pickClient(c: IntakeClient) {
    setClient(c); setOpname(null); setDetail(null); setScriptId(null); setDriveLink(""); setDrive({ state: "idle" }); setError(null);
    setLoadingOpnames(true); setOpnames([]);
    const res = await intakeOpnames(c.id);
    setLoadingOpnames(false);
    if (res.ok) setOpnames(res.data!.opnames); else setError(res.message);
  }

  async function pickOpname(o: IntakeOpname) {
    setOpname(o); setDetail(null); setScriptId(null); setDriveLink(""); setDrive({ state: "idle" }); setError(null);
    const res = await intakeOpnameDetail(o.id);
    if (!res.ok) { setError(res.message); return; }
    const d = res.data!.detail; setDetail(d);
    if (d && d.scripts.length) setScriptId(d.scripts[0]!.id); // automatisch het (eerste) script
    // Drive automatisch: de opname heeft al een map → controleer en vul in.
    if (d?.driveFolderId && driveConfigured) {
      setDriveLink(d.driveFolderId);
      setDrive({ state: "checking", auto: true });
      const dr = await checkDriveFolder(d.driveFolderId);
      if (dr.ok) setDrive({ state: "ok", count: dr.data!.count, auto: true });
      else setDrive({ state: "idle" }); // val terug op handmatig
    }
  }

  function checkDrive() {
    if (!driveLink.trim()) { setDrive({ state: "err", msg: "Plak eerst een Google Drive-maplink." }); return; }
    setChecking(true); setDrive({ state: "checking" });
    start(async () => {
      const res = await checkDriveFolder(driveLink.trim());
      setChecking(false);
      if (res.ok) setDrive({ state: "ok", count: res.data!.count });
      else setDrive({ state: "err", msg: res.message });
    });
  }

  function launch() {
    if (!client || !opname || !scriptId) return;
    setError(null);
    start(async () => {
      const res = await createProjectFromIntake({
        clientId: client.id, productionDayId: opname.id, scriptId,
        driveLink: driveLink.trim() || undefined, instructions: instructions.trim() || undefined,
      });
      if (res.ok) router.push(`/ai-editor/${res.data!.id}`);
      else setError(res.message);
    });
  }

  const script = detail?.scripts.find((s) => s.id === scriptId) ?? null;
  const footageReady = drive.state === "ok";
  const ready = Boolean(client && opname && scriptId);

  return (
    <Card padded={false} className="mb-5 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-5 py-3">
        <span className="font-semibold">Nieuwe video aanleveren</span>
        <button type="button" onClick={onClose} className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Annuleren</button>
      </div>

      <div className="space-y-5 p-5">
        {/* STAP 1 — Klant & opname */}
        <Step n={1} title="Klant & opname" done={!!opname}>
          <p className="mb-2 text-xs font-medium text-[var(--color-ink-muted)]">Klant</p>
          <div className="flex flex-wrap gap-2">
            {clients.map((c) => {
              const sel = client?.id === c.id;
              return (
                <button key={c.id} type="button" onClick={() => pickClient(c)}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm font-medium transition ${sel ? "bg-[var(--color-indigo-ink)] text-white ring-2 ring-[var(--color-brand-400)]" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`}>
                  <span className="grid size-8 place-items-center rounded-full text-2xs font-bold text-white" style={{ background: c.color ?? "var(--color-brand-500)" }}>{initials(c.name)}</span>
                  {c.name}
                </button>
              );
            })}
            {clients.length === 0 ? <span className="text-sm text-[var(--color-ink-faint)]">Geen klanten beschikbaar.</span> : null}
          </div>

          {client ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-[var(--color-ink-muted)]">Opname</p>
              {loadingOpnames ? (
                <p className="text-sm text-[var(--color-ink-faint)]"><Loader2 className="mr-1 inline size-3.5 animate-spin" /> Opnames laden…</p>
              ) : opnames.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-4 text-center text-sm text-[var(--color-ink-faint)]">Geen recente of geplande opnames voor deze klant.</p>
              ) : (
                <div className="space-y-2">
                  {opnames.map((o) => {
                    const sel = opname?.id === o.id;
                    return (
                      <button key={o.id} type="button" onClick={() => pickOpname(o)}
                        className={`flex w-full items-start gap-3 rounded-[var(--radius-sm)] border px-3.5 py-3 text-left transition ${sel ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--color-line)] hover:border-[var(--color-brand-400)] hover:bg-[var(--color-surface-sunken)]"}`}>
                        <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${sel ? "border-[var(--color-brand-500)]" : "border-[var(--color-line-strong)]"}`}>{sel ? <span className="size-2.5 rounded-full bg-[var(--color-brand-500)]" /> : null}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{o.title}</span>
                          <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">{fmtDate(o.scheduledOn)} · {o.scriptCount > 0 ? `${o.scriptCount} script${o.scriptCount === 1 ? "" : "s"}` : "geen script"} · {o.hasDrive ? "beelden gekoppeld" : "geen Drive-map"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </Step>

        {/* STAP 2 — Script */}
        <Step n={2} title="Script (automatisch uit het portaal)" done={!!scriptId} locked={!opname}>
          {!opname ? <p className="text-sm text-[var(--color-ink-faint)]">Kies eerst een opname — het script verschijnt dan hier.</p>
            : !detail || detail.scripts.length === 0 ? <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-4 text-center text-sm text-[var(--color-ink-faint)]">Geen script gekoppeld aan deze opname. Maak er eerst een in Scripting.</p>
            : (
              <div className="space-y-2">
                {detail.scripts.length > 1 ? <p className="text-xs text-[var(--color-ink-faint)]">Meerdere scripts gevonden — kies de juiste.</p> : null}
                {detail.scripts.map((s) => {
                  const sel = scriptId === s.id;
                  return (
                    <button key={s.id} type="button" onClick={() => setScriptId(s.id)}
                      className={`flex w-full items-start gap-3 rounded-[var(--radius-sm)] border px-3.5 py-3 text-left transition ${sel ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--color-line)] hover:border-[var(--color-brand-400)]"}`}>
                      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${sel ? "border-[var(--color-brand-500)]" : "border-[var(--color-line-strong)]"}`}>{sel ? <span className="size-2.5 rounded-full bg-[var(--color-brand-500)]" /> : null}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{s.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs">
                          <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-ink-muted)]">{STATUS_LABEL[s.status] ?? s.status}</span>
                          {s.hasNotes ? <span className="rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 font-medium text-[#0060a8]">bevat montageaanwijzingen</span> : null}
                        </span>
                        {sel && s.preview ? <span className="mt-2 block max-h-24 overflow-auto whitespace-pre-line rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-2.5 text-xs text-[var(--color-ink-muted)]">{s.preview}{s.preview.length >= 320 ? "…" : ""}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
        </Step>

        {/* STAP 3 — Google Drive */}
        <Step n={3} title="Beeldmateriaal (Google Drive)" done={footageReady} locked={!opname}>
          {!opname ? <p className="text-sm text-[var(--color-ink-faint)]">Verschijnt zodra je een opname hebt gekozen.</p>
            : !driveConfigured ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2.5 text-sm text-[#8a5300]">Google Drive is nog niet gekoppeld. Doe dat bij Instellingen → Koppelingen.</p>
            : (
              <>
                {drive.auto && drive.state === "ok" ? (
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-50)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-brand-600)]"><Sparkles className="size-3.5" /> Automatisch gekoppeld vanuit de opname</div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <input type="text" value={driveLink} onChange={(e) => { setDriveLink(e.target.value); setDrive({ state: "idle" }); }}
                    placeholder="https://drive.google.com/drive/folders/…"
                    className="sc-input h-10 min-w-56 flex-1 text-sm" />
                  <Button variant="secondary" size="md" onClick={checkDrive} disabled={checking || pending}>
                    {drive.state === "checking" ? <Loader2 className="size-4 animate-spin" /> : <FolderCheck className="size-4" />} Controleer toegang
                  </Button>
                </div>
                {drive.state === "ok" ? (
                  <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-good)]/40 bg-[var(--color-good-soft)] px-3 py-2.5 text-sm font-medium text-[var(--color-good)]">✓ Verbonden — {drive.count} videobestand{drive.count === 1 ? "" : "en"} gevonden.</div>
                ) : drive.state === "err" ? (
                  <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] px-3 py-2.5 text-sm text-[var(--color-bad)]">✕ {drive.msg}</div>
                ) : null}
              </>
            )}
        </Step>

        {/* STAP 4 — Extra instructies */}
        <Step n={4} title="Extra instructies voor de AI Editor" optional done={false} locked={!opname}>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-50)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-brand-600)]">
            <Wand2 className="size-3.5" /> De montageaanwijzingen uit het script worden automatisch meegenomen — hieronder alleen extra wensen.
          </div>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4}
            placeholder="Bijv. Begin direct met de reactie van de klant, gebruik snelle cuts, ondertiteling in merkkleur en houd het onder de 30 seconden."
            className="sc-input w-full resize-y text-sm" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <VoiceButton onText={(t) => setInstructions((d) => (d.trim() ? d.trim() + " " : "") + t)} label="Inspreken" />
            <div className="flex flex-wrap gap-1.5">
              {[["Snelle cuts", "Gebruik snelle cuts op de beat."], ["Ondertiteling", "Voeg ondertiteling toe in de merkkleur."], ["Max 30 sec", "Houd de video onder de 30 seconden."], ["Hook eerst", "Begin direct met de sterkste hook."]].map(([lbl, q]) => (
                <button key={lbl} type="button" onClick={() => setInstructions((d) => (d.trim() ? d.trim() + " " : "") + q)}
                  className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-600)]">
                  <MessageSquarePlus className="mr-1 inline size-3" />{lbl}
                </button>
              ))}
            </div>
          </div>
        </Step>

        {/* STAP 5 — Controleren & starten */}
        <Step n={5} title="Controleren & starten" done={false} locked={!ready}>
          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)]">
            {[
              ["Klant", !!client, client?.name],
              ["Opname", !!opname, opname ? `${opname.title} · ${fmtDate(opname.scheduledOn)}` : null],
              ["Script", !!scriptId, script ? script.title + (script.hasNotes ? "  (+ montageaanwijzingen)" : "") : null],
              ["Beeldmateriaal", footageReady, footageReady ? `${drive.count} bestanden uit Google Drive` : "nog koppelen"],
            ].map(([label, ok, val]) => (
              <div key={label as string} className="flex items-center gap-2.5 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm last:border-b-0">
                <span className={`grid size-5 place-items-center rounded-full ${ok ? "bg-[var(--color-good)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-faint)]"}`}>{ok ? <Check className="size-3" /> : ""}</span>
                <span className="w-28 shrink-0 font-semibold text-[var(--color-ink-faint)]">{label as string}</span>
                <span className="min-w-0 flex-1 font-medium">{(val as string) || <span className="text-[var(--color-ink-faint)]">nog niet gekozen</span>}</span>
              </div>
            ))}
          </div>

          {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}

          <button type="button" onClick={launch} disabled={!ready || pending}
            className="mt-3 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-5 text-base font-bold text-white shadow-[0_6px_18px_rgba(255,106,0,0.3)] transition disabled:text-[var(--color-ink-faint)] disabled:shadow-none"
            style={{ background: !ready || pending ? "var(--color-surface-2)" : "#FF6A00" }}>
            {pending ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
            {!ready ? "Kies klant, opname en script" : footageReady ? "AI Editor starten" : "Aanmaken — beelden toevoegen"}
          </button>
          <p className="mt-2 text-center text-xs text-[var(--color-ink-faint)]">Er wordt een concept gemaakt dat je daarna kunt bijsturen. Niets wordt automatisch opgeleverd.</p>
        </Step>
      </div>
    </Card>
  );
}

function Step({ n, title, children, done, locked, optional }: { n: number; title: string; children: React.ReactNode; done?: boolean; locked?: boolean; optional?: boolean }) {
  return (
    <section className={locked ? "opacity-55" : ""}>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className={`grid size-7 place-items-center rounded-full text-sm font-bold ${done ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]"}`}>{done ? <Check className="size-4" /> : n}</span>
        <h3 className="text-sm font-semibold">{title}{optional ? <span className="ml-1.5 text-xs font-normal text-[var(--color-ink-faint)]">· optioneel</span> : null}</h3>
      </div>
      <div className="pl-[38px]">{children}</div>
    </section>
  );
}
