"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { DAGRITME, toMinutes } from "@/lib/werkdag";

const nowMinutesAmsterdam = () =>
  toMinutes(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" }));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const duur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}u ${String(m).padStart(2, "0")}m` : `${m} min`;
};

export type Focus = { title: string; clientName: string | null; reason: string; href: string | null; tone: "bad" | "warn" | "info" | "neutral" } | null;

/**
 * Werkdagbalk: hoe ver is de werkdag, hoe laat is het, hoeveel werktijd rest
 * er nog en welk vast moment komt eraan. Rechts staat de taak die nu
 * prioriteit heeft. Loopt live mee (elke 30 s).
 */
export function WerkdagBalk({
  start, end, isWorkday, offToday, nextDayLabel, focus,
}: {
  start: string; end: string; isWorkday: boolean; offToday: string | null; nextDayLabel: string; focus: Focus;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Pas na mount de echte tijd (voorkomt hydration-verschil), daarna elke 30 s.
    const tick = () => setNow(nowMinutesAmsterdam());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);

  const s = toMinutes(start);
  const e = toMinutes(end);
  const active = isWorkday && !offToday;
  const pct = now == null || !active ? 0 : Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100));
  const inDay = active && now != null && now >= s && now < e;

  const current = active && now != null ? DAGRITME.find((d) => now >= toMinutes(d.from) && now < toMinutes(d.to ?? d.from) + (d.to ? 0 : 15)) : undefined;
  const upcoming = active && now != null ? DAGRITME.find((d) => toMinutes(d.from) > now) : undefined;

  let headline: string;
  let sub: string;
  if (!isWorkday) {
    headline = "Geen werkdag vandaag";
    sub = `Eerstvolgende werkdag: ${nextDayLabel}`;
  } else if (offToday) {
    headline = `Vandaag vrij (${offToday})`;
    sub = `Je taken staan klaar voor ${nextDayLabel}`;
  } else if (now == null) {
    headline = "—";
    sub = "";
  } else if (now < s) {
    headline = `Werkdag start om ${start}`;
    sub = `Nog ${duur(s - now)} tot de start`;
  } else if (now >= e) {
    headline = "Werkdag voorbij";
    sub = `Morgen verder · ${nextDayLabel}`;
  } else {
    headline = `${Math.round(pct)}% van de werkdag`;
    sub = `Nog ${duur(e - now)} werktijd tot ${end}`;
  }

  const focusTone: Record<string, string> = {
    bad: "border-[var(--color-bad)] bg-[var(--color-bad-soft)]",
    warn: "border-[var(--color-warn)] bg-[var(--color-warn-soft)]",
    info: "border-[var(--color-brand-700)] bg-[#eaf0fd]",
    neutral: "border-[var(--color-indigo-ink)]/30 bg-[var(--color-surface-sunken)]",
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] text-white shadow-sm">
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-center">
        {/* Voortgang van de werkdag */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums tracking-tight">{now == null ? "--:--" : hhmm(now)}</span>
              <span className="text-sm font-semibold">{headline}</span>
            </div>
            <span className="text-xs text-white/70">{sub}</span>
          </div>

          <div className="relative mt-3 h-2.5 rounded-full bg-white/12">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--color-good)] to-[var(--color-lime)] transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
            {/* Vaste momenten als markeringen */}
            {DAGRITME.map((d) => {
              const at = ((toMinutes(d.from) - s) / (e - s)) * 100;
              if (at < 0 || at > 100) return null;
              const past = now != null && active && now >= toMinutes(d.from);
              return (
                <span
                  key={d.from}
                  title={`${d.from} ${d.label}`}
                  className={`absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full ${past ? "bg-white/40" : "bg-white/80"}`}
                  style={{ left: `${at}%` }}
                />
              );
            })}
            {inDay ? (
              <span
                className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[var(--color-good)] shadow"
                style={{ left: `${pct}%` }}
              />
            ) : null}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-white/60">
            <span className="tabular-nums">{start}</span>
            <span className="flex min-w-0 items-center gap-1.5 truncate text-white/80">
              <Clock className="size-3.5 shrink-0" />
              {current ? (
                <span className="truncate"><strong className="font-semibold text-white">Nu:</strong> {current.label}</span>
              ) : upcoming ? (
                <span className="truncate">Straks {upcoming.from} · {upcoming.label}</span>
              ) : (
                <span className="truncate">Geen vaste momenten meer vandaag</span>
              )}
            </span>
            <span className="tabular-nums">{end}</span>
          </div>
        </div>

        {/* Wat heeft nu prioriteit */}
        <Link
          href={focus?.href ?? "/tasks"}
          className={`block min-w-0 rounded-[var(--radius-md,10px)] border-l-4 px-4 py-3 text-[var(--color-ink)] transition hover:brightness-[0.98] ${focus ? focusTone[focus.tone] : focusTone.neutral}`}
        >
          <div className="text-2xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">Nu eerst</div>
          {focus ? (
            <>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {focus.clientName ? `${focus.clientName} · ` : ""}{focus.title}
                </span>
                <ArrowRight className="size-4 shrink-0 opacity-60" />
              </div>
              <div className="truncate text-xs text-[var(--color-ink-muted)]">{focus.reason}</div>
            </>
          ) : (
            <div className="mt-0.5 text-sm font-semibold">Niets urgents. Pak iets uit Deze week afronden.</div>
          )}
        </Link>
      </div>
    </div>
  );
}
