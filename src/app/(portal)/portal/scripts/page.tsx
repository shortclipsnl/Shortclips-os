import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, FileText, MapPin, MessageSquareText } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { CLIENT_ACTION_STATUSES, listPortalScriptReviews, SCRIPT_REVIEW_STATUS, type PortalReviewListItem } from "@/server/script-review";
import { ScriptLeeswijzer } from "@/components/portal/script-leeswijzer";
import { Badge, buttonClass } from "@/components/ui";
import { daysUntil, formatDateFull, relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Scripts" };
export const dynamic = "force-dynamic";

// "warn" (actie nodig) tonen we in het portaal als navy i.p.v. oranje, gelijk
// aan het interne platform (geen oranje in de huisstijl).
const TONE: Record<string, "ink" | "info" | "good" | "neutral"> = { warn: "ink", info: "info", good: "good", neutral: "neutral" };

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

export default async function PortalScriptsPage() {
  const viewer = await requirePortal();
  const [reviews, data, settings] = await Promise.all([listPortalScriptReviews(viewer), getPortalData(viewer), getPortalSettingsForClient(viewer.clientId ?? "")]);

  const actieNodig = reviews.filter((r) => CLIENT_ACTION_STATUSES.includes(r.status));
  const bijShortclips = reviews.filter((r) => r.status === "feedback_gegeven" || r.status === "wordt_aangepast");
  const goedgekeurd = reviews.filter((r) => r.status === "goedgekeurd");
  const reviewByDay = new Map(reviews.map((r) => [r.productionDayId, r]));

  // Elke aankomende opname met het script dat erbij hoort, plus eventuele
  // scripts die op je wachten waarvan de opname niet (meer) in de lijst staat.
  const upcomingDayIds = new Set(data.upcomingShoots.map((s) => s.id));
  const opnameRows = [
    ...data.upcomingShoots.map((s) => ({
      key: `shoot-${s.id}`,
      date: s.scheduledOn,
      time: s.startTime ?? null,
      location: s.locationName ?? null,
      review: reviewByDay.get(s.id) ?? null,
    })),
    ...reviews
      .filter((r) => CLIENT_ACTION_STATUSES.includes(r.status) && r.shootOn && !upcomingDayIds.has(r.productionDayId))
      .map((r) => ({ key: `rev-${r.id}`, date: r.shootOn!, time: r.shootTime, location: r.shootLocation, review: r })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const shoot = data.upcomingShoot;
  const klaarCount = actieNodig.length;
  // Eerlijke status i.p.v. "niets openstaand": komt de opname eraan en staat er
  // nog geen script voor klaar, zeg dat we het afronden (geen vals "niets te doen").
  const shootReview = shoot ? reviewByDay.get(shoot.id) ?? null : null;
  const daysToShoot = shoot ? daysUntil(shoot.scheduledOn) : null;
  const shootSoonNoScript =
    !!shoot && daysToShoot != null && daysToShoot >= 0 && daysToShoot <= 7 &&
    (!shootReview || (shootReview.status !== "goedgekeurd" && !CLIENT_ACTION_STATUSES.includes(shootReview.status)));

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

        <section className="sc-glass flex flex-col p-5" style={klaarCount > 0 ? { boxShadow: "inset 3px 0 0 var(--sc-accent)" } : undefined}>
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
            <MessageSquareText className="size-4 text-[var(--sc-accent)]" /> Scriptstatus
          </span>
          {klaarCount > 0 ? (
            <>
              <div className="mt-3 text-[15px] font-semibold text-[var(--sc-accent)]">
                {klaarCount} script{klaarCount === 1 ? "" : "s"} {klaarCount === 1 ? "wacht" : "wachten"} op jouw controle
              </div>
              <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Bekijk de scripts hieronder en geef je akkoord of feedback.</p>
            </>
          ) : shootSoonNoScript ? (
            <>
              <div className="mt-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--sc-accent)]"><Clock className="size-5" /> Scripts in de maak</div>
              <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                We ronden je scripts af voor de opname van {formatDateFull(shoot!.scheduledOn)} ({relativeDays(shoot!.scheduledOn)}). Je krijgt bericht zodra ze klaarstaan om te controleren.
                {bijShortclips.length > 0 ? ` ${bijShortclips.length} bij Shortclips in bewerking.` : ""}
              </p>
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

      {/* Aankomende opnames staan bovenaan (belangrijkst) — met het script dat
          erbij hoort ernaast, zodat meteen duidelijk is welk script bij welke
          opname hoort. De leeswijzer ("zo controleer je") staat eronder. */}
      {opnameRows.length > 0 ? (
        <section>
          <h2 className="mb-1 text-base font-semibold">Aankomende opnames & scripts</h2>
          <p className="mb-3 text-[13px] text-[var(--color-ink-muted)]">Per opname zie je het bijbehorende script en de status. Scripts die op jou wachten zijn duidelijk gemarkeerd.</p>
          <div className="flex flex-col gap-3">
            {opnameRows.map((o) => {
              const actie = o.review ? CLIENT_ACTION_STATUSES.includes(o.review.status) : false;
              return (
                <div key={o.key} className="sc-glass flex flex-wrap items-center gap-4 p-4" style={actie ? { boxShadow: "inset 3px 0 0 var(--sc-accent)" } : undefined}>
                  <span className="grid size-11 shrink-0 flex-col place-items-center rounded-[12px] border border-[var(--sc-line)] bg-gradient-to-br from-[rgba(25,168,255,0.22)] to-[rgba(27,95,224,0.22)] text-center">
                    <span className="text-[16px] font-bold leading-none">{new Date(`${o.date}T12:00:00`).getDate()}</span>
                    <span className="text-[9px] uppercase text-[var(--color-ink-muted)]">{new Date(`${o.date}T12:00:00`).toLocaleDateString("nl-NL", { month: "short" })}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-semibold">{formatDateFull(o.date)}</div>
                    <div className="text-[12.5px] text-[var(--color-ink-muted)]">
                      {relativeDays(o.date)}{o.time ? ` · vanaf ${o.time.slice(0, 5)}` : ""}{o.location ? ` · ${o.location}` : ""}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--sc-line)] pt-2">
                      <FileText className="size-4 shrink-0 text-[var(--sc-accent)]" />
                      {o.review ? (
                        <>
                          <span className="text-[13px] font-medium">{o.review.title}</span>
                          <StatusBadge status={o.review.status} />
                          {o.review.openComments > 0 ? <span className="text-[11.5px] text-[var(--color-ink-faint)]">{o.review.openComments} opmerking{o.review.openComments === 1 ? "" : "en"}</span> : null}
                        </>
                      ) : (
                        <span className="text-[13px] text-[var(--color-ink-faint)]">Script wordt voorbereid — je krijgt bericht zodra het klaarstaat</span>
                      )}
                    </div>
                  </div>
                  {o.review ? (
                    <Link href={`/portal/scripts/${o.review.id}`} className={`${buttonClass({ variant: actie ? "accent" : "secondary", size: "sm" })} shrink-0`}>
                      {actie ? "Bekijk & geef feedback" : "Bekijk script"} <ArrowRight className="size-4" />
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Leeswijzer: hoe lees en controleer je de scripts ("Zo lees je de
          scripts") — onder de aankomende scripts, want die zijn belangrijker. */}
      <ScriptLeeswijzer feedbackDays={settings.feedbackDaysScripts} />

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
