import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckCircle2, FileText, Info, MapPin, MessageSquareText } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalScriptReview, type ScriptReviewStatus } from "@/server/script-review";
import { formatDateFull, relativeDays } from "@/lib/format";
import { ScriptPdfReview } from "@/components/portal/script-pdf-review";
import { ScriptReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "Script bekijken" };
export const dynamic = "force-dynamic";

/**
 * Portaal-weergave van de statussen — bewust opvallender dan intern: de statussen
 * waarbij de klant iets moet doen krijgen een felle oranje accentpil, zodat
 * meteen duidelijk is wat aandacht nodig heeft. Labels zijn klantgericht.
 */
const PORTAL_STATUS: Record<ScriptReviewStatus, { label: string; cls: string; dot: string }> = {
  klaar_controle:   { label: "Klaar voor controle",   cls: "bg-[#ff6a00] text-white", dot: "bg-white" },
  opnieuw_controle: { label: "Opnieuw ter controle",  cls: "bg-[#ff6a00] text-white", dot: "bg-white" },
  feedback_gegeven: { label: "Feedback ontvangen",    cls: "bg-[rgba(46,144,250,0.15)] text-[#1b6fe8]", dot: "bg-[#1b6fe8]" },
  wordt_aangepast:  { label: "Wordt aangepast",       cls: "bg-[rgba(46,144,250,0.15)] text-[#1b6fe8]", dot: "bg-[#1b6fe8]" },
  goedgekeurd:      { label: "Goedgekeurd door klant", cls: "bg-[rgba(47,210,122,0.18)] text-[#1d8a52]", dot: "bg-[#2fd27a]" },
};

/** Splitst een opmerking-body in een eventueel aangestreept citaat ("> …") en de tekst. */
function splitQuote(body: string): { quote: string | null; text: string } {
  const lines = body.replace(/\r/g, "").split("\n");
  const quoteLines: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i]!.startsWith(">")) { quoteLines.push(lines[i]!.replace(/^>\s?/, "")); i++; }
  const text = lines.slice(i).join("\n").trim();
  return { quote: quoteLines.length ? quoteLines.join(" ").trim() : null, text: text || body };
}

export default async function PortalScriptReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const viewer = await requirePortal();
  const review = await getPortalScriptReview(viewer, reviewId);
  if (!review) notFound();

  const status = PORTAL_STATUS[review.status];
  const when = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const canAnnotate = review.status !== "goedgekeurd";

  // Opmerkingen sorteren: op pagina (algemene bovenaan), nieuwste eerst.
  const threads = [...review.threads].sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));
  const commentCount = review.threads.length;

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Terug + kop */}
      <div>
        <Link href="/portal/scripts" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--sc-accent)] hover:underline">
          <ArrowLeft className="size-4" /> Terug naar scripts
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-tight">{review.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
              {review.shootOn ? (
                <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-[var(--sc-accent)]" /> {formatDateFull(review.shootOn)} · {relativeDays(review.shootOn)}{review.shootTime ? ` · vanaf ${review.shootTime.slice(0, 5)}` : ""}</span>
              ) : null}
              {review.shootLocation ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-[var(--sc-accent)]" /> {review.shootLocation}</span> : null}
              {review.currentVersion > 1 ? <span>versie {review.currentVersion}</span> : null}
            </div>
          </div>
          {/* Opvallende statuspil */}
          <span className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-bold shadow-sm ${status.cls}`}>
            <span className={`size-2 rounded-full ${status.dot} ${canAnnotate && review.status !== "feedback_gegeven" && review.status !== "wordt_aangepast" ? "animate-pulse" : ""}`} />
            {status.label}
          </span>
        </div>
        {review.status !== "goedgekeurd" && review.feedbackDeadline ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[rgba(25,168,255,0.14)] px-3 py-1 text-[13px] font-semibold text-[#19a8ff]">
            <CalendarClock className="size-4" /> Wacht op jouw feedback · geef je reactie vóór {new Date(review.feedbackDeadline).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        ) : null}
      </div>

      {/* PDF links, feedbackkolom rechts (stapelt op mobiel). */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {review.currentVersionId ? (
            <ScriptPdfReview
              url={`/api/portal/script-pdf/${review.currentVersionId}`}
              reviewId={review.id}
              canAnnotate={canAnnotate}
              pins={review.threads.map((t) => ({ id: t.id, pageNumber: t.pageNumber, posX: t.posX, posY: t.posY, isResolved: t.isResolved, authorName: t.authorName, comments: t.comments }))}
            />
          ) : (
            <div className="sc-glass grid place-items-center gap-2 p-10 text-center">
              <FileText className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
              <p className="text-sm text-[var(--color-ink-muted)]">Er staat nog geen PDF klaar voor dit script.</p>
            </div>
          )}
        </div>

        {/* Feedbackkolom */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start">
          {/* Korte uitleg */}
          <div className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <div className="flex items-center gap-2">
              <Info className="size-4 text-[var(--sc-accent)]" />
              <h2 className="text-[14px] font-semibold">Zo geef je feedback</h2>
            </div>
            <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>• <strong className="text-[var(--color-ink)]">Selecteer een zin</strong> in het script, of tik op een plek, en typ je opmerking.</li>
              <li>• Je opmerkingen verschijnen hieronder, per pagina.</li>
              <li>• Klaar? Klik onderaan op <strong className="text-[var(--color-ink)]">Feedback doorgeven</strong>, of keur direct goed.</li>
            </ul>
          </div>

          {/* Geplaatste opmerkingen */}
          <div className="min-h-0 flex-1 overflow-auto rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <MessageSquareText className="size-4 text-[var(--sc-accent)]" />
              <h2 className="text-[14px] font-semibold">Jouw opmerkingen</h2>
              <span className="ml-auto rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink-muted)] tabular-nums">{commentCount}</span>
            </div>
            {threads.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[var(--color-ink-faint)]">Nog geen opmerkingen. Selecteer een zin in het script om er een toe te voegen.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {threads.map((t) => {
                  const c = t.comments[0];
                  const parsed = c ? splitQuote(c.body) : { quote: null, text: "" };
                  return (
                    <li key={t.id} className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-3">
                      <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--color-ink-faint)]">
                        <span>{t.pageNumber ? `Pagina ${t.pageNumber}` : "Algemeen"}{t.versionNumber ? ` · versie ${t.versionNumber}` : ""}</span>
                        {t.isResolved ? <span className="inline-flex items-center gap-1 text-[#2fd27a]"><CheckCircle2 className="size-3.5" /> Verwerkt</span> : null}
                      </div>
                      {parsed.quote ? (
                        <p className="mt-1.5 border-l-2 border-[#ff6a00] bg-[rgba(255,106,0,0.08)] px-2 py-1 text-[12px] italic leading-snug text-[var(--color-ink-muted)]">“{parsed.quote}”</p>
                      ) : null}
                      {t.comments.map((cm) => {
                        const p = splitQuote(cm.body);
                        return (
                          <div key={cm.id} className="mt-1.5">
                            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--color-ink)]">{p.text}</p>
                            <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{cm.authorName ?? "Jij"} · {when(cm.createdAt)}</p>
                          </div>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Twee duidelijke actieknoppen onderaan */}
          <ScriptReviewActions
            reviewId={review.id}
            approved={review.status === "goedgekeurd"}
            approvedByName={review.approvedByName}
            approvedAt={review.approvedAt}
            commentCount={commentCount}
            alreadySubmitted={review.status === "feedback_gegeven" || review.status === "wordt_aangepast"}
          />
        </aside>
      </div>
    </div>
  );
}
