import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, CalendarRange, Camera, Check, ClipboardCheck, Clock, ExternalLink, Eye, FileText, Film, Mail, MapPin, MessageCircle, MessagesSquare, Phone, Play, Radio, Sparkles } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalData, getPortalFrameUrl, getPortalPackageProgress } from "@/server/portal";
import { CLIENT_ACTION_STATUSES, listPortalScriptReviews } from "@/server/script-review";
import { buttonClass, ClientLogo, TeamAvatar } from "@/components/ui";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";

/** +31 6 ... → 316... voor wa.me. */
function waNumber(phone: string): string {
  return phone.replace(/[^\d]/g, "").replace(/^0/, "31");
}

export const metadata: Metadata = { title: "Jouw omgeving" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";

/** "Woensdag 29 oktober 2026" — volledige datum met weekdag (hoofdletter). */
function fullDate(d: Date): string {
  const s = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function timeOf(d: Date): string {
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
/** "YYYY-MM-DD" → Date op het middaguur (voorkomt tijdzone-verschuiving). */
function dateFromIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

/** Datumblok (grote dag + maand) in de huisstijl-blauw, zodat belangrijke datums
 *  en opnames eruit springen — gelijk aan het interne platform (geen oranje). */
function DateChip({ date }: { date: Date }) {
  return (
    <div className="flex size-[58px] shrink-0 flex-col items-center justify-center rounded-[14px] bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white shadow-[0_6px_16px_-6px_rgba(27,95,224,0.6)]">
      <span className="text-xl font-bold leading-none tabular-nums">{date.getDate()}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/85">
        {date.toLocaleDateString("nl-NL", { month: "short", timeZone: TZ })}
      </span>
    </div>
  );
}

/** Eén planningskaart (opnamedag of scriptmeeting) — zelfde opbouw, rustig.
 *  Met `accent` springt de kaart eruit (gekleurde rand + lichte achtergrond),
 *  zodat de eerstvolgende opnamedag duidelijk de aandacht trekt. */
function PlanCard({
  icon,
  label,
  date,
  time,
  location,
  emptyText,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  date: Date | null;
  time: string | null;
  location: string | null;
  emptyText: string;
  accent?: boolean;
}) {
  return (
    <section
      className="sc-glass flex min-h-[132px] flex-col p-5"
      style={accent && date ? { boxShadow: "inset 3px 0 0 var(--sc-accent)", background: "linear-gradient(180deg, rgba(25,168,255,0.1), rgba(255,255,255,0.02))" } : undefined}
    >
      <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider ${accent && date ? "text-[var(--sc-accent)]" : "text-[var(--color-ink-faint)]"}`}>
        <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]">{icon}</span>
        {label}
      </div>
      {date ? (
        <div className="mt-4 flex items-start gap-3.5">
          <DateChip date={date} />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-snug">{fullDate(date)}</div>
            <div className="mt-1 flex flex-col gap-1 text-[13px] text-[var(--color-ink-muted)]">
              {time ? (
                <span className="flex items-center gap-1.5"><Clock className="size-3.5 shrink-0" /> vanaf {time} uur</span>
              ) : null}
              {location ? (
                <span className="flex items-center gap-1.5"><MapPin className="size-3.5 shrink-0" /> {location}</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 flex flex-1 items-center text-sm text-[var(--color-ink-muted)]">{emptyText}</p>
      )}
    </section>
  );
}

/** Eén resultaatcijfer, met korte periode-/contextlabel eronder. */
function ResultTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="sc-glass p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="text-[var(--sc-accent)]">{icon}</span> {label}
      </div>
      <div className="mt-2 text-[26px] font-bold tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 text-[11px] text-[var(--color-ink-faint)]">{sub}</div>
    </div>
  );
}

/** Scriptstatus vertaald naar begrijpelijke klanttaal (geen interne termen). */
function scriptStatusMeta(status: string): { label: string; tone: "action" | "ready" | "done" | "prep" } {
  switch (status) {
    case "client_review":
      return { label: "Ter controle bij jou", tone: "action" };
    case "approved":
    case "ready_to_shoot":
      return { label: "Klaar voor de opname", tone: "ready" };
    case "shot":
      return { label: "Opgenomen", tone: "done" };
    default:
      return { label: "In voorbereiding", tone: "prep" };
  }
}

const SCRIPT_TONE: Record<"action" | "ready" | "done" | "prep", string> = {
  action: "bg-[rgba(25,168,255,0.18)] text-[#19a8ff]",
  ready: "bg-[#2fd27a]/15 text-[#1a9956]",
  done: "bg-[var(--sc-fill-strong)] text-[var(--color-ink-muted)]",
  prep: "bg-[var(--sc-fill)] text-[var(--color-ink-muted)]",
};

export default async function PortalPage() {
  const viewer = await requirePortal();
  const [data, contact, scriptReviews, frameUrl, pkg] = await Promise.all([
    getPortalData(viewer),
    getPortalContact(viewer),
    listPortalScriptReviews(viewer),
    getPortalFrameUrl(viewer),
    getPortalPackageProgress(viewer),
  ]);

  const companyName = data.client.name;

  // Openstaande acties: scripts ter controle + video's ter beoordeling.
  const actionableScripts = scriptReviews.filter((r) => CLIENT_ACTION_STATUSES.includes(r.status));
  const scriptActions = actionableScripts.length;
  const videoActions = data.awaitingApproval.length;
  const openActions = scriptActions + videoActions;
  // Eerstvolgende opnamedatum onder de te-controleren scripts → als deadline-hint.
  const soonestScriptShoot = actionableScripts.map((r) => r.shootOn).filter((d): d is string => !!d).sort()[0] ?? null;

  // Eerstvolgende geplande publicatie (uit de goedgekeurde contentplanning).
  const nextPub = data.calendar[0] ?? null;
  const coordinator = contact.coordinator;

  // 2 — Planning. Volgende opnamedag uit de bestaande klantplanning.
  const shoot = data.upcomingShoot;
  const shootDate = shoot ? dateFromIso(shoot.scheduledOn) : null;
  const shootTime = shoot?.startTime ? shoot.startTime.slice(0, 5) : null;
  const shootScripts = data.shootScripts ?? [];

  // Scriptmeeting = eerstvolgende afspraak van het type "scriptbespreking"
  // (uit de gekoppelde agenda). Geen dubbele invoer.
  const scriptMeeting = data.appointments.find((a) => a.kind === "scriptbespreking") ?? null;
  const scriptDate = scriptMeeting ? new Date(scriptMeeting.startsAt) : null;
  const scriptTime = scriptMeeting && !scriptMeeting.allDay && scriptDate ? timeOf(scriptDate) : null;

  // 3 — Video's: hoeveel wachten er op beoordeling (subtiele, relevante hint).
  const pendingReview = data.awaitingApproval.length + (data.scriptsToReview?.length ?? 0);

  // 4 — Resultaten (laatste 30 dagen, uit de gekoppelde cijfers) + totaal online.
  const m = data.metrics;
  const online = data.published.length;
  const hasMetrics = m.views + m.reach + m.engagements > 0;

  return (
    <div className="flex flex-col gap-[22px]">
      {/* 1 — Persoonlijke welkomstsectie */}
      <section className="flex items-start gap-4 px-0.5 pt-1">
        <ClientLogo name={companyName} logoUrl={data.client.logoUrl} color={data.client.color} size={56} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Welkom bij Shortclips</p>
          <h1 className="text-[30px] font-bold tracking-tight">{companyName}</h1>
          <p className="mt-1.5 text-[14px] text-[var(--color-ink-muted)]">Je persoonlijke omgeving. Hieronder zie je in één oogopslag wat er speelt.</p>
        </div>
      </section>

      <h2 className="px-0.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Aan jou</h2>

      {/* Actie nodig — alleen tonen als er echt iets van de klant wordt verwacht */}
      {openActions > 0 ? (
        <section className="sc-glass sc-glow p-5" style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.12), rgba(255,255,255,0.03))" }}>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.18)] text-[#19a8ff]"><Bell className="size-4" /></span>
            <h2 className="text-[15px] font-bold">Actie nodig</h2>
            <span className="rounded-full bg-[rgba(25,168,255,0.18)] px-2 py-0.5 text-2xs font-bold text-[#19a8ff]">{openActions}</span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {scriptActions > 0 ? (
              <Link href="/portal/scripts" className="flex items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-3 transition-colors hover:border-[var(--sc-line)]">
                <FileText className="size-4 shrink-0 text-[var(--sc-accent)]" />
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {scriptActions} script{scriptActions === 1 ? "" : "s"} wacht op jouw controle
                  {soonestScriptShoot ? <span className="font-normal text-[var(--color-ink-muted)]"> · vóór de opname van {formatDate(soonestScriptShoot)}</span> : null}
                </span>
                <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
              </Link>
            ) : null}
            {videoActions > 0 ? (
              <Link href="/portal/videos" className="flex items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-3 transition-colors hover:border-[var(--sc-line)]">
                <Play className="size-4 shrink-0 text-[var(--sc-accent)]" fill="currentColor" />
                <span className="min-w-0 flex-1 text-sm font-medium">{videoActions} video{videoActions === 1 ? "" : "'s"} wacht op jouw beoordeling</span>
                <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
              </Link>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="sc-glass flex items-center gap-3 p-5" style={{ background: "linear-gradient(180deg, rgba(47,210,122,0.08), rgba(255,255,255,0.02))" }}>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[rgba(47,210,122,0.16)] text-[#2fd27a]"><Check className="size-4" /></span>
          <div>
            <p className="text-[14.5px] font-semibold">Alles loopt, jij hoeft niets te doen</p>
            <p className="text-[13px] text-[var(--color-ink-muted)]">Er wacht op dit moment niets op je. Zodra er iets klaarstaat om te controleren of te beoordelen, zie je het hier.</p>
          </div>
        </section>
      )}

      <h2 className="px-0.5 pt-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Je opnames &amp; scripts</h2>

      {/* 2 — Volgende opnamedag en scriptmeeting, naast elkaar */}
      <div className="grid gap-[18px] sm:grid-cols-2">
        <PlanCard
          icon={<Camera className="size-[18px]" strokeWidth={1.9} />}
          label="Volgende opnamedag"
          date={shootDate}
          time={shootTime}
          location={shoot?.locationName ?? null}
          emptyText="Nog geen opname gepland. Je contactpersoon neemt contact met je op zodra er een datum staat."
          accent
        />
        <PlanCard
          icon={<MessagesSquare className="size-[18px]" strokeWidth={1.9} />}
          label="Scriptmeeting"
          date={scriptDate}
          time={scriptTime}
          location={scriptMeeting?.location ?? null}
          emptyText="Nog geen scriptmeeting gepland."
        />
      </div>

      {/* Scripts die bij de eerstvolgende opnamedag horen — zo ziet de klant dat
          de scripts voor die dag al klaarstaan, en in welke fase ze zitten. */}
      {shootDate && shootScripts.length > 0 ? (
        <section className="sc-glass p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
            <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><FileText className="size-[18px]" strokeWidth={1.9} /></span>
            Scripts voor deze opnamedag
            <span className="rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 text-2xs font-bold text-[var(--color-ink-muted)]">{shootScripts.length}</span>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {shootScripts.map((s) => {
              const st = scriptStatusMeta(s.status);
              return (
                <li key={s.id}>
                  <Link href="/portal/scripts" className="flex items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-2.5 transition-colors hover:border-[var(--sc-accent)]">
                    <FileText className="size-4 shrink-0 text-[var(--sc-accent)]" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</span>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${SCRIPT_TONE[st.tone]}`}>{st.label}</span>
                    <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Voorbereidingsherinnering — alleen als er een opname aankomt */}
      {shootDate ? (
        <Link href="/portal/planning#voorbereiding" className="group flex items-center gap-3 rounded-[14px] border border-[#2e90fa]/25 bg-[rgba(46,144,250,0.06)] px-4 py-3 transition-colors hover:border-[var(--sc-accent)]">
          <ClipboardCheck className="size-5 shrink-0 text-[var(--sc-accent)]" />
          <span className="min-w-0 flex-1 text-[13.5px]"><span className="font-semibold">Bereid je opname voor</span> <span className="text-[var(--color-ink-muted)]">bekijk de checklist en de dagindeling.</span></span>
          <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-muted)] transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}

      <h2 className="px-0.5 pt-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Je video&apos;s &amp; planning</h2>

      {/* 3 — Directe toegang tot de video's: rechtstreeks naar de Frame.io-omgeving
          van de klant als die is ingesteld, anders naar de videopagina in het portaal. */}
      <a
        href={frameUrl ?? "/portal/videos"}
        {...(frameUrl ? { target: "_blank", rel: "noreferrer" } : {})}
        className="sc-glass sc-glow group flex flex-wrap items-center gap-4 p-5 transition-colors hover:border-[var(--sc-line)]"
        style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.1), rgba(255,255,255,0.03))" }}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[rgba(25,168,255,0.16)] text-[var(--sc-accent)]">
          <Film className="size-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">Bekijk jouw video&apos;s</h2>
          <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">
            {frameUrl ? "Je video's staan in Frame.io; daar bekijk je ze en geef je feedback." : "Bekijk alle opnamesessies en video's van jouw bedrijf."}
            {pendingReview > 0 ? (
              <span className="ml-1 font-medium text-[#19a8ff]">
                {pendingReview} {pendingReview === 1 ? "wacht" : "wachten"} op jouw beoordeling.
              </span>
            ) : null}
          </p>
        </div>
        <span className={`${buttonClass({ variant: "accent", size: "md" })} shrink-0`}>
          {frameUrl ? <><Play className="size-4" fill="currentColor" /> Open in Frame.io <ExternalLink className="size-4" /></> : <><Play className="size-4" fill="currentColor" /> Bekijk video&apos;s <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
        </span>
      </a>

      {/* Eerstvolgende publicatie + snelkoppeling naar de volledige contentplanning */}
      <div className="grid gap-[18px] sm:grid-cols-2">
        <section className="sc-glass flex flex-col p-5">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
            <CalendarRange className="size-4 text-[var(--sc-accent)]" /> Eerstvolgende publicatie
          </span>
          {nextPub ? (
            <div className="mt-4 flex items-start gap-3.5">
              <DateChip date={dateFromIso(nextPub.scheduledOn)} />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">{nextPub.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--color-ink-muted)]">
                  <span>{fullDate(dateFromIso(nextPub.scheduledOn))}</span>
                  {((nextPub.platforms as string[]) ?? []).map((p) => <span key={p} className="rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 text-[11px]">{PLATFORM[p]?.label ?? p}</span>)}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 flex flex-1 items-center text-sm text-[var(--color-ink-muted)]">Nog geen publicatie ingepland.</p>
          )}
          {/* Wie plaatst de video's — duidelijk voor de klant (afspraak per klant). */}
          <p className="mt-4 flex items-center gap-1.5 border-t border-[var(--sc-line)] pt-3 text-[13px] text-[var(--color-ink-muted)]">
            <Radio className="size-3.5 shrink-0 text-[var(--sc-accent)]" />
            {data.client.weHandlePosting
              ? "Shortclips plaatst jullie video's op de afgesproken kanalen."
              : "Jullie plaatsen de video's zelf; wij leveren ze kant-en-klaar aan."}
          </p>
        </section>
        <Link href="/portal/planning" className="sc-glass group flex items-center gap-4 p-5 transition-colors hover:border-[var(--sc-line)]">
          <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><CalendarRange className="size-6" strokeWidth={1.8} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">Jouw contentplanning</h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Bekijk wanneer welke video online komt.</p>
          </div>
          <ArrowRight className="size-5 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      <h2 className="px-0.5 pt-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Je resultaten &amp; pakket</h2>

      {/* Pakketteller: hoeveel video's deze maand online t.o.v. de afspraak */}
      {pkg ? (
        <section className="sc-glass p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                <Film className="size-4 text-[var(--sc-accent)]" /> Jouw pakket · {pkg.monthLabel}
              </span>
              <p className="mt-2 text-[15px] font-semibold">
                {pkg.onlineThisMonth} van {pkg.quota} video&apos;s deze maand online
              </p>
            </div>
            <span className="text-[13px] text-[var(--color-ink-muted)]">
              {pkg.remaining > 0 ? `nog ${pkg.remaining} te gaan` : "pakket voor deze maand compleet"}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--sc-fill-strong)]">
            <div className="h-full rounded-full bg-[var(--sc-accent)]" style={{ width: `${Math.min(100, Math.round((pkg.onlineThisMonth / pkg.quota) * 100))}%` }} />
          </div>
        </section>
      ) : null}

      {/* 4 — Resultatenoverzicht */}
      <section>
        <div className="mb-3 flex items-center justify-end gap-3">
          <Link href="/portal/resultaten" className={buttonClass({ variant: "secondary", size: "sm" })}>Alle resultaten bekijken <ArrowRight className="size-4" /></Link>
        </div>
        {hasMetrics ? (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <ResultTile icon={<Eye className="size-3.5" />} label="Weergaven" value={compact(m.views)} sub="laatste 30 dagen" />
            <ResultTile icon={<Radio className="size-3.5" />} label="Bereik" value={compact(m.reach)} sub="laatste 30 dagen" />
            <ResultTile icon={<Sparkles className="size-3.5" />} label="Interacties" value={compact(m.engagements)} sub="laatste 30 dagen" />
            <ResultTile icon={<Film className="size-3.5" />} label="Video's online" value={num(online)} sub="totaal gepubliceerd" />
          </div>
        ) : (
          <div className="sc-glass flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><Film className="size-5" /></span>
              <div>
                <div className="text-[17px] font-bold tabular-nums leading-none">{num(online)} video&apos;s online</div>
                <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Zodra je content online staat, zie je hier je weergaven, bereik en interacties.</p>
              </div>
            </div>
            {online > 0 ? (
              <Link href="/portal/videos" className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}>Bekijk video&apos;s</Link>
            ) : null}
          </div>
        )}
      </section>

      {/* Vaste contactpersoon — met profielfoto, contactgegevens en directe knoppen */}
      {coordinator ? (
        <section className="sc-glass flex flex-wrap items-center gap-5 p-5">
          <TeamAvatar name={coordinator.name} avatarUrl={coordinator.avatarUrl} size={80} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Je vaste contactpersoon</div>
            <div className="mt-0.5 text-[17px] font-semibold">{coordinator.name}</div>
            <div className="text-[13px] text-[var(--color-ink-muted)]">{coordinator.role}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-[var(--color-ink-muted)]">
              {coordinator.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3" /> {coordinator.phone}</span> : null}
              {coordinator.email ? <span className="inline-flex items-center gap-1"><Mail className="size-3" /> {coordinator.email}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {coordinator.phone ? (
              <a href={`https://wa.me/${waNumber(coordinator.phone)}`} target="_blank" rel="noreferrer" className={buttonClass({ variant: "accent", size: "sm" })}><MessageCircle className="size-4" /> WhatsApp</a>
            ) : null}
            {coordinator.phone ? (
              <a href={`tel:${coordinator.phone}`} className={buttonClass({ variant: "secondary", size: "sm" })}><Phone className="size-4" /> Bellen</a>
            ) : null}
            {coordinator.email ? (
              <a href={`mailto:${coordinator.email}`} className={buttonClass({ variant: "secondary", size: "sm" })}><Mail className="size-4" /> E-mail</a>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
