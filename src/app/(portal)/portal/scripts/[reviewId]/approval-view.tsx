"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, BookOpen, Check, CheckCircle2, Clock, Loader2, MessageSquareText, PencilLine, Send, Undo2 } from "lucide-react";
import {
  addScriptReviewComment,
  approveRemainingScripts,
  approveScriptPage,
  submitScriptReviewFeedback,
  undoScriptPageApproval,
} from "@/server/actions/script-review";
import { ScriptPdfReview, type ReviewPin } from "@/components/portal/script-pdf-review";
import { ErrorNote } from "@/components/ui";
import { SCRIPT_PAGE_LABEL, type ScriptPageState } from "@/lib/script-approval";
import type { ReviewApproval, ScriptReviewStatus } from "@/server/script-review";

type Thread = {
  id: string;
  versionNumber: number;
  pageNumber: number | null;
  isResolved: boolean;
  comments: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
};

const STATE_PILL: Record<ScriptPageState, string> = {
  todo: "bg-[var(--st-orange-bg)] text-[var(--st-orange)]",
  revised: "bg-[var(--st-orange-bg)] text-[var(--st-orange)]",
  change: "bg-[var(--st-blue-bg)] text-[var(--st-blue)]",
  approved: "bg-[var(--st-green-bg)] text-[var(--st-green)]",
};

/** Zelfde knopvorm overal: groot, groen, één klik. */
const APPROVE_BTN =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--st-green)] px-6 text-[15.5px] font-bold text-white shadow-sm transition hover:brightness-105 active:brightness-95 disabled:opacity-60 sm:w-auto sm:min-w-[260px]";
const QUIET_BTN =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium text-[var(--color-ink-muted)] transition hover:bg-[var(--sc-fill-strong)] hover:text-[var(--color-ink)] disabled:opacity-60";

function stripQuote(body: string): { quote: string | null; text: string } {
  const lines = body.replace(/\r/g, "").split("\n");
  const q: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i]!.startsWith(">")) { q.push(lines[i]!.replace(/^>\s?/, "")); i++; }
  const text = lines.slice(i).join("\n").trim();
  return { quote: q.length ? q.join(" ").trim() : null, text: text || body };
}

function scrollToPage(page: number) {
  document.getElementById(`script-page-${page}`)?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
}

export function ScriptApprovalView({
  reviewId,
  pdfUrl,
  status,
  currentVersion,
  approval,
  pins,
  threads,
  deadlineLabel,
  approvedByName,
  approvedAt,
}: {
  reviewId: string;
  pdfUrl: string | null;
  status: ScriptReviewStatus;
  currentVersion: number;
  approval: ReviewApproval;
  pins: ReviewPin[];
  threads: Thread[];
  deadlineLabel: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyPage, setBusyPage] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const [suggestPage, setSuggestPage] = useState<number | null>(null);
  const [optimistic, setOptimistic] = useState<Map<number, ScriptPageState>>(() => new Map());
  const [roundMsg, setRoundMsg] = useState<"feedback" | null>(null);
  const [showInfoPages, setShowInfoPages] = useState(false);

  const final = status === "goedgekeurd";
  const scripts = useMemo(
    () => approval.scripts.map((s) => ({ ...s, state: final ? ("approved" as const) : optimistic.get(s.page) ?? s.state })),
    [approval.scripts, optimistic, final],
  );
  const byPage = useMemo(() => new Map(scripts.map((s) => [s.page, s])), [scripts]);
  const total = scripts.length;
  const approvedCount = scripts.filter((s) => s.state === "approved").length;
  const changeCount = scripts.filter((s) => s.state === "change").length;
  const openScripts = scripts.filter((s) => s.state === "todo" || s.state === "revised");
  const allOpenSeen = openScripts.length > 0 && openScripts.every((s) => seen.has(s.page));
  const waitingOnUs = !final && (status === "feedback_gegeven" || status === "wordt_aangepast");

  const onPageSeen = useCallback((p: number) => {
    setSeen((prev) => (prev.has(p) ? prev : new Set(prev).add(p)));
  }, []);

  // Verder waar de klant gebleven was: bij openen naar het eerste open script
  // springen als er al scripts beoordeeld zijn. De pagina's verschijnen pas na
  // het laden van de PDF, dus even wachten tot het element er is.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || final) return;
    const first = approval.scripts.find((s) => s.state === "todo" || s.state === "revised");
    if (!first || first.index === 1) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const el = document.getElementById(`script-page-${first.page}`);
      if (el || tries > 60) {
        clearInterval(t);
        if (!el || jumped.current) return;
        jumped.current = true;
        // Direct springen en daarna nog twee keer bijsturen, voor het geval
        // pagina's erboven nog laden. Stopt zodra de klant zelf scrolt.
        el.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
        let last = window.scrollY;
        for (const ms of [500, 1400]) {
          setTimeout(() => {
            if (Math.abs(window.scrollY - last) > 40) return;
            el.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
            last = window.scrollY;
          }, ms);
        }
      }
    }, 150);
    return () => clearInterval(t);
  }, [approval.scripts, final]);

  function nextOpenAfter(page: number): number | null {
    const after = openScripts.find((s) => s.page > page && s.page !== page);
    return after?.page ?? openScripts.find((s) => s.page !== page)?.page ?? null;
  }

  function handleRound(round: string | undefined) {
    if (round === "feedback") setRoundMsg("feedback");
    router.refresh();
  }

  function approvePage(page: number) {
    setErr(null);
    setBusyPage(page);
    const next = nextOpenAfter(page);
    setOptimistic((m) => new Map(m).set(page, "approved"));
    start(async () => {
      const res = await approveScriptPage({ reviewId, pageNumber: page });
      setBusyPage(null);
      if (!res.ok) {
        setOptimistic((m) => { const n = new Map(m); n.delete(page); return n; });
        setErr(res.message ?? "Goedkeuren mislukt.");
        return;
      }
      handleRound(res.round);
      if (next && res.round === "open") setTimeout(() => scrollToPage(next), 250);
    });
  }

  function undo(page: number) {
    setErr(null);
    setBusyPage(page);
    setOptimistic((m) => new Map(m).set(page, "todo"));
    start(async () => {
      const res = await undoScriptPageApproval({ reviewId, pageNumber: page });
      setBusyPage(null);
      if (!res.ok) setErr(res.message ?? "Ongedaan maken mislukt.");
      setOptimistic((m) => { const n = new Map(m); n.delete(page); return n; });
      router.refresh();
    });
  }

  function approveRest() {
    setErr(null);
    start(async () => {
      const res = await approveRemainingScripts(reviewId);
      if (!res.ok) { setErr(res.message ?? "Goedkeuren mislukt."); return; }
      handleRound(res.round);
    });
  }

  function sendChangesNow() {
    setErr(null);
    start(async () => {
      const res = await submitScriptReviewFeedback({ reviewId });
      if (!res.ok) { setErr(res.message ?? "Versturen mislukt."); return; }
      setRoundMsg("feedback");
      router.refresh();
    });
  }

  /* ---------------------------------------------------------- per script */

  function renderBelowPage(page: number) {
    const s = byPage.get(page);
    if (!s) return null;
    const pageThreads = threads.filter((t) => t.pageNumber === page && t.versionNumber === currentVersion);
    const busy = pending && busyPage === page;
    return (
      <div className="w-full rounded-[14px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px] font-semibold">Script {s.index} <span className="font-normal text-[var(--color-ink-faint)]">van {total}</span></span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${STATE_PILL[s.state]}`}>
            {s.state === "approved" ? <Check className="size-3.5" strokeWidth={3} /> : null}
            {SCRIPT_PAGE_LABEL[s.state]}
          </span>
        </div>

        {pageThreads.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {pageThreads.map((t) => {
              const first = t.comments[0];
              if (!first) return null;
              const p = stripQuote(first.body);
              return (
                <li key={t.id} className="rounded-[10px] bg-[var(--sc-fill)] px-3 py-2 text-[13px]">
                  {p.quote ? <p className="mb-1 border-l-2 border-[var(--st-orange)] pl-2 text-[12px] italic text-[var(--color-ink-muted)]">“{p.quote}”</p> : null}
                  <p className="whitespace-pre-wrap text-[var(--color-ink)]">{p.text}</p>
                  {t.isResolved ? <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--st-green)]"><CheckCircle2 className="size-3.5" /> Verwerkt</p> : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {final ? null : s.state === "approved" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-[14px] font-semibold text-[var(--st-green)]">
              <CheckCircle2 className="size-5" /> Script goedgekeurd{s.approvedByName ? <span className="font-normal text-[var(--color-ink-muted)]">· {s.approvedByName}</span> : null}
            </p>
            <button type="button" onClick={() => undo(page)} disabled={pending} className={QUIET_BTN}>
              <Undo2 className="size-4" /> Ongedaan maken
            </button>
          </div>
        ) : suggestPage === page ? (
          <SuggestChange
            reviewId={reviewId}
            page={page}
            onDone={(round) => { setSuggestPage(null); handleRound(round); }}
            onCancel={() => setSuggestPage(null)}
          />
        ) : (
          <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => approvePage(page)} disabled={pending} className={APPROVE_BTN}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" strokeWidth={3} />} Script goedkeuren
            </button>
            <button type="button" onClick={() => { setErr(null); setSuggestPage(page); }} disabled={pending} className={QUIET_BTN}>
              <PencilLine className="size-4" /> {s.state === "change" ? "Nog een wijziging" : "Wijziging voorstellen"}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------- overzicht */

  const pct = total > 0 ? Math.round((approvedCount / total) * 100) : final ? 100 : 0;
  const nextOpen = openScripts[0]?.page ?? null;

  const overview = (
    <div className="flex flex-col gap-4 rounded-[16px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4 sm:p-5">
      {final ? (
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--st-green-bg)] text-[var(--st-green)]"><CheckCircle2 className="size-5" /></span>
          <div>
            <p className="text-[16px] font-bold">Alle scripts zijn goedgekeurd</p>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
              Je hoeft niets meer te doen.{approvedByName ? ` Goedgekeurd door ${approvedByName}` : ""}{approvedAt ? ` op ${new Date(approvedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}` : ""}.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div>
            <p className="text-[18px] font-bold tracking-tight">
              {total > 0 ? <>{approvedCount} van de {total} scripts goedgekeurd</> : "Scripts beoordelen"}
            </p>
            {total > 0 ? (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sc-fill-strong)]" aria-hidden>
                <div className="h-full rounded-full bg-[var(--st-green)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
            {deadlineLabel && !waitingOnUs ? (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-muted)]"><Clock className="size-4" /> {deadlineLabel}</p>
            ) : null}
          </div>

          {waitingOnUs || roundMsg === "feedback" ? (
            <p className="rounded-[10px] bg-[var(--st-blue-bg)] px-3 py-2.5 text-[13px] text-[var(--color-ink)]">
              Bedankt. We verwerken je wijzigingen en laten het weten zodra de aangepaste versie klaarstaat.
              {openScripts.length > 0 ? " De overige scripts kun je intussen gewoon goedkeuren." : ""}
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              Is de inhoud akkoord? Dan kun je het script direct goedkeuren. Heb je een belangrijke wijziging? Geef die dan door via <span className="whitespace-nowrap">Wijziging voorstellen</span>.
            </p>
          )}

          {total > 0 ? (
            <ul className="flex flex-col gap-1">
              {scripts.map((s) => (
                <li key={s.page}>
                  <button type="button" onClick={() => scrollToPage(s.page)} className="flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] transition hover:bg-[var(--sc-fill-strong)]">
                    <span className="inline-flex items-center gap-2">
                      <span className={`grid size-5 place-items-center rounded-full text-[10.5px] font-bold ${s.state === "approved" ? "bg-[var(--st-green)] text-white" : "bg-[var(--sc-fill-strong)] text-[var(--color-ink-muted)]"}`}>
                        {s.state === "approved" ? <Check className="size-3" strokeWidth={3} /> : s.index}
                      </span>
                      Script {s.index}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${STATE_PILL[s.state]}`}>{SCRIPT_PAGE_LABEL[s.state]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {openScripts.length > 1 || total === 0 ? (
            <div className="border-t border-[var(--sc-line)] pt-3">
              <button
                type="button"
                onClick={approveRest}
                disabled={pending || (total > 0 && !allOpenSeen)}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border-2 border-[var(--st-green)] px-4 text-[14px] font-bold text-[var(--st-green)] transition hover:bg-[var(--st-green-bg)] disabled:cursor-not-allowed disabled:border-[var(--sc-line)] disabled:text-[var(--color-ink-faint)] disabled:hover:bg-transparent"
              >
                <Check className="size-4" strokeWidth={3} />
                {total > 0 ? `Alle resterende scripts goedkeuren (${openScripts.length})` : "Scripts goedkeuren"}
              </button>
              {total > 0 && !allOpenSeen ? (
                <p className="mt-1.5 text-center text-[12px] text-[var(--color-ink-faint)]">Wordt actief zodra je alle scripts hebt bekeken.</p>
              ) : null}
            </div>
          ) : null}

          {changeCount > 0 && openScripts.length > 0 && !waitingOnUs && roundMsg !== "feedback" ? (
            <button type="button" onClick={sendChangesNow} disabled={pending} className={`${QUIET_BTN} self-start`}>
              <Send className="size-4" /> Wijzigingen al doorsturen
            </button>
          ) : null}
        </>
      )}
      {err ? <ErrorNote>{err}</ErrorNote> : null}
    </div>
  );

  const generalThreads = threads.filter((t) => t.pageNumber == null || !byPage.has(t.pageNumber));

  return (
    <div className="grid grid-cols-1 gap-5 pb-20 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-0">
      {/* Mobiel: overzicht boven het script. */}
      <div className="lg:hidden">{overview}</div>

      <div className="min-w-0">
        {pdfUrl ? (
          <ScriptPdfReview
            url={pdfUrl}
            reviewId={reviewId}
            canAnnotate={!final}
            annotatePage={total > 0 ? suggestPage : suggestPage === 0 ? undefined : null}
            contained={false}
            pins={pins}
            renderBelowPage={total > 0 ? renderBelowPage : undefined}
            onPageSeen={onPageSeen}
            showPage={total > 0 && !showInfoPages ? (n) => byPage.has(n) : undefined}
            aboveDocument={total > 0 ? (
              <button
                type="button"
                onClick={() => setShowInfoPages((v) => !v)}
                className="inline-flex items-center gap-1.5 self-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
              >
                <BookOpen className="size-3.5" /> {showInfoPages ? "Alleen de scripts tonen" : "Toon ook de uitlegpagina's"}
              </button>
            ) : undefined}
          />
        ) : null}
        {total === 0 && !final && pdfUrl ? (
          <div className="mt-4 rounded-[14px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-4 sm:p-5">
            {suggestPage === 0 ? (
              <SuggestChange reviewId={reviewId} page={null} onDone={(round) => { setSuggestPage(null); handleRound(round); }} onCancel={() => setSuggestPage(null)} />
            ) : (
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={approveRest} disabled={pending} className={APPROVE_BTN}>
                  {pending ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" strokeWidth={3} />} Scripts goedkeuren
                </button>
                <button type="button" onClick={() => setSuggestPage(0)} disabled={pending} className={QUIET_BTN}>
                  <PencilLine className="size-4" /> Wijziging voorstellen
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">
        <div className="hidden lg:block">{overview}</div>
        {generalThreads.length > 0 ? (
          <div className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <MessageSquareText className="size-4 text-[var(--color-ink-muted)]" />
              <h2 className="text-[13.5px] font-semibold">Algemene opmerkingen</h2>
            </div>
            <ul className="flex flex-col gap-2">
              {generalThreads.map((t) => (
                <li key={t.id} className="rounded-[10px] bg-[var(--color-surface)] px-3 py-2 text-[13px]">
                  {t.comments.map((c) => <p key={c.id} className="whitespace-pre-wrap">{stripQuote(c.body).text}</p>)}
                  <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">{t.pageNumber ? `Pagina ${t.pageNumber} · ` : ""}versie {t.versionNumber}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      {/* Mobiel: rustige balk onderin met voortgang en sprong naar het volgende script. */}
      {!final && total > 0 && nextOpen ? (
        <div className="fixed inset-x-3 z-30 flex items-center justify-between gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-header-bg)] px-4 py-2 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] backdrop-blur lg:hidden" style={{ bottom: "calc(env(safe-area-inset-bottom) + 72px)" }}>
          <span className="text-[13px] font-semibold"><span className="text-[var(--st-green)]">{approvedCount}</span> van {total} goedgekeurd</span>
          <button type="button" onClick={() => scrollToPage(nextOpen)} className="inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--st-green)] px-3 py-2 text-[13px] font-bold text-white">
            Volgend script <ArrowDown className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Opmerkingenveld per script: pas zichtbaar na "Wijziging voorstellen". */
function SuggestChange({ reviewId, page, onDone, onCancel }: { reviewId: string; page: number | null; onDone: (round?: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setErr(null);
    start(async () => {
      const res = page
        ? await addScriptReviewComment({ reviewId, pageNumber: page, body: body.trim() })
        : await submitScriptReviewFeedback({ reviewId, note: body.trim() });
      if (!res.ok) { setErr(res.message ?? "Versturen mislukt."); return; }
      onDone(page ? res.round : "feedback");
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <p className="text-[13px] text-[var(--color-ink-muted)]">
        Beschrijf de aanpassing die echt nodig is, zoals een onjuist cijfer, een naam of iets dat niet naar buiten mag. Kleine tekstuele verschillen passen we vaak nog aan tijdens de opname.
        {page ? " Je kunt ook een zin in het script hierboven selecteren." : ""}
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        autoFocus
        maxLength={4000}
        placeholder="Wat moet er anders?"
        className="sc-input w-full resize-y text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !body.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[var(--color-ink)] px-4 text-[13.5px] font-semibold text-[var(--color-surface)] transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Versturen
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={QUIET_BTN}>Annuleren</button>
      </div>
      {err ? <ErrorNote>{err}</ErrorNote> : null}
    </div>
  );
}
