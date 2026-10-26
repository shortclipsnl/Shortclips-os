import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, FileText, MapPin, MessageSquareText } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { CLIENT_ACTION_STATUSES, listPortalScriptReviews, SCRIPT_REVIEW_STATUS, type PortalReviewListItem } from "@/server/script-review";
import { Badge, buttonClass } from "@/components/ui";
import { formatDateFull, relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Scripts" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "warn" | "info" | "good" | "neutral"> = { warn: "warn", info: "info", good: "good", neutral: "neutral" };

function StatusBadge({ status }: { status: PortalReviewListItem["status"] }) {
  const meta = SCRIPT_REVIEW_STATUS[status];
  return <Badge tone={TONE[meta.tone]}>{meta.label}</Badge>;
}

function fmtShootLine(r: { shootOn: string | null; shootTime: string | null; shootLocation: string | null }): string {
  if (!r.shootOn) return "";
  const parts = [formatDateFull(r.shootOn)];
  if (r.shootTime) parts.push(`vanaf ${r.shootTime.slice(0, 5)}`);
  if (r.shootLocation) parts.push(r.shootLocation);
  return parts.join(" · ");
}

function ReviewCard({ r }: { r: PortalReviewListItem }) {
  const actie = CLIENT_ACTION_STATUSES.includes(r.status);
  return (
    <Link
      href={`/portal/scripts/${r.id}`}
      className="sc-glass group flex flex-wrap items-center gap-4 p-5 transition-colors hover:border-[var(--sc-line)]"
      style={actie ? { boxShadow: "inset 3px 0 0 #ffb020" } : undefined}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]">
        <FileText className="size-5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-semibold">{r.title}</h3>
          <StatusBadge status={r.status} />
        </div>
        <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
          {fmtShootLine(r) || "Opnamedatum volgt"}
          {r.currentVersion > 1 ? ` · versie ${r.currentVersion}` : ""}
          {r.openComments > 0 ? ` · ${r.openComments} opmerking${r.openComments === 1 ? "" : "en"} geplaatst` : ""}
        </p>
        {actie && r.feedbackDeadline ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#ffb020]">
            <Clock className="size-3.5" /> Wacht op jouw feedback · vóór {new Date(r.feedbackDeadline).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long" })}
          </p>
        ) : null}
      </div>
      <span className={`${buttonClass({ variant: actie ? "accent" : "secondary", size: "sm" })} shrink-0`}>
        Bekijk scripts <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export default async function PortalScriptsPage() {
  const viewer = await requirePortal();
  const [reviews, data] = await Promise.all([listPortalScriptReviews(viewer), getPortalData(viewer)]);

  const actieNodig = reviews.filter((r) => CLIENT_ACTION_STATUSES.includes(r.status));
  const bijShortclips = reviews.filter((r) => r.status === "feedback_gegeven" || r.status === "wordt_aangepast");
  const goedgekeurd = reviews.filter((r) => r.status === "goedgekeurd");
  const reviewByDay = new Map(reviews.map((r) => [r.productionDayId, r]));

  const shoot = data.upcomingShoot;
  const klaarCount = actieNodig.length;

  return (
    <div className="flex flex-col gap-[22px]">
      {/* Kop */}
      <div className="px-0.5 pt-1">
        <h1 className="text-[26px] font-bold tracking-tight">Scripts</h1>
        <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
          Bekijk je scripts, geef eenvoudig feedback en keur ze goed — rechtstreeks hier, vóór de opnamedag.
        </p>
      </div>

      {/* Bovenin: volgende opname + of er actie nodig is */}
      <div className="grid gap-[18px] sm:grid-cols-2">
        <section className="sc-glass p-5">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
            <CalendarClock className="size-4 text-[var(--sc-accent)]" /> Volgende opnamedag
          </span>
          {shoot ? (
            <>
              <div className="mt-3 text-[15px] font-semibold">{formatDateFull(shoot.scheduledOn)}</div>
              <div className="mt-1 flex flex-col gap-1 text-[13px] text-[var(--color-ink-muted)]">
                <span>{relativeDays(shoot.scheduledOn)}{shoot.startTime ? ` · vanaf ${shoot.startTime.slice(0, 5)} uur` : ""}</span>
                {shoot.locationName ? <span className="flex items-center gap-1.5"><MapPin className="size-3.5" /> {shoot.locationName}</span> : null}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen opname gepland.</p>
          )}
        </section>

        <section className="sc-glass flex flex-col p-5" style={klaarCount > 0 ? { boxShadow: "inset 3px 0 0 #ffb020" } : undefined}>
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
            <MessageSquareText className="size-4 text-[var(--sc-accent)]" /> Scriptstatus
          </span>
          {klaarCount > 0 ? (
            <>
              <div className="mt-3 text-[15px] font-semibold text-[#ffb020]">
                {klaarCount} script{klaarCount === 1 ? "" : "s"} {klaarCount === 1 ? "wacht" : "wachten"} op jouw controle
              </div>
              <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Bekijk de scripts hieronder en geef je akkoord of feedback.</p>
            </>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2 text-[15px] font-semibold text-[#2fd27a]"><CheckCircle2 className="size-5" /> Niets openstaand</div>
              <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                {goedgekeurd.length > 0 ? `${goedgekeurd.length} script${goedgekeurd.length === 1 ? "" : "s"} goedgekeurd.` : "Je hoeft nu niets te doen."}
                {bijShortclips.length > 0 ? ` ${bijShortclips.length} bij Shortclips in bewerking.` : ""}
              </p>
            </>
          )}
        </section>
      </div>

      {/* Scripts die op je wachten */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Scripts die op je wachten</h2>
        {actieNodig.length === 0 ? (
          <div className="sc-glass grid place-items-center gap-2 p-10 text-center">
            <FileText className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
            <p className="text-sm font-medium">Geen scripts die op je wachten</p>
            <p className="max-w-md text-[13px] text-[var(--color-ink-muted)]">Zodra er scripts klaarstaan voor jouw controle, verschijnen ze hier. Je hoeft nu niets te doen.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {actieNodig.map((r) => <ReviewCard key={r.id} r={r} />)}
          </div>
        )}
      </section>

      {/* Aankomende opnames + scriptstatus */}
      {data.upcomingShoots.length > 0 ? (
        <section>
          <h2 className="mb-3 text-base font-semibold">Aankomende opnames</h2>
          <div className="sc-glass divide-y divide-white/10">
            {data.upcomingShoots.map((s) => {
              const rev = reviewByDay.get(s.id);
              const inner = (
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <span className="grid size-10 shrink-0 flex-col place-items-center rounded-[12px] border border-[var(--sc-line)] bg-gradient-to-br from-[rgba(25,168,255,0.22)] to-[rgba(27,95,224,0.22)] text-center">
                    <span className="text-[15px] font-bold leading-none">{new Date(`${s.scheduledOn}T12:00:00`).getDate()}</span>
                    <span className="text-[9px] uppercase text-[var(--color-ink-muted)]">{new Date(`${s.scheduledOn}T12:00:00`).toLocaleDateString("nl-NL", { month: "short" })}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{formatDateFull(s.scheduledOn)}</div>
                    <div className="text-[12.5px] text-[var(--color-ink-muted)]">
                      {relativeDays(s.scheduledOn)}
                      {s.startTime ? ` · vanaf ${s.startTime.slice(0, 5)}` : ""}
                      {s.locationName ? ` · ${s.locationName}` : ""}
                    </div>
                  </div>
                  {rev ? <StatusBadge status={rev.status} /> : <span className="text-[12px] text-[var(--color-ink-faint)]">Scripts volgen</span>}
                </div>
              );
              return rev ? (
                <Link key={s.id} href={`/portal/scripts/${rev.id}`} className="block transition-colors hover:bg-[var(--sc-fill)]">{inner}</Link>
              ) : (
                <div key={s.id}>{inner}</div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Eerder goedgekeurd */}
      {goedgekeurd.length > 0 ? (
        <section>
          <h2 className="mb-3 text-base font-semibold">Eerder goedgekeurd</h2>
          <div className="sc-glass divide-y divide-white/10">
            {goedgekeurd.map((r) => (
              <Link key={r.id} href={`/portal/scripts/${r.id}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-[var(--sc-fill)]">
                <CheckCircle2 className="size-5 shrink-0 text-[#2fd27a]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{r.title}</div>
                  <div className="text-[12.5px] text-[var(--color-ink-muted)]">{fmtShootLine(r) || "Goedgekeurd"}</div>
                </div>
                <Badge tone="good">Goedgekeurd</Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="flex items-center gap-1.5 pt-1 text-xs text-[var(--color-ink-faint)]">
        <Clock className="size-3.5" /> Alles staat hier klaar — je hoeft niet meer naar Adobe of e-mail. Je feedback wordt automatisch bewaard.
      </footer>
    </div>
  );
}
