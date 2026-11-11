"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ScreenReel, ScreenReelItem } from "@/server/screen-reel";
import { nextIndex } from "@/lib/screen-reel-match";

/* ------------------------------------------------------------------ *
 * Kantoorscherm: speelt automatisch echte klantvideo's af met de echte
 * cijfers ernaast. Draait zelfstandig: kiest zelf de volgende video, slaat
 * kapotte video's over, haalt elke 10 minuten nieuwe data op en houdt het
 * scherm wakker. Geen knoppen behalve 'Schermvullend' (verschijnt alleen
 * als de muis beweegt).
 * ------------------------------------------------------------------ */

type Totals = {
  views: number;
  reach: number;
  posts: number;
  followerGrowth: number;
  viewsGrowthPct: number | null;
};

type Props = {
  initialReel: ScreenReel;
  initialTotals: Totals;
  initialClientCount: number;
};

const NAVY = "#00003b";
const MUTED = "rgba(255,255,255,0.62)";
const LINE = "rgba(255,255,255,0.12)";
const POLL_MS = 10 * 60_000;
/** Lange video's niet eindeloos laten lopen. */
const MAX_PLAY_MS = 150_000;
/** Zonder voortgang na zoveel tijd: video overslaan. */
const STALL_MS = 15_000;
/** Een video die faalde, een tijd niet opnieuw proberen. */
const FAIL_PAUSE_MS = 30 * 60_000;
const FADE_MS = 700;

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

const REASON_LABEL: Record<ScreenReelItem["reason"], string> = {
  nieuw: "Net online",
  top: "Topvideo",
  uitschieter: "Uitschieter",
};

const nf = new Intl.NumberFormat("nl-NL");
const fmt = (n: number) => nf.format(Math.round(n));

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
}

/** Getal dat optelt naar de waarde: vanaf 0 bij een nieuwe video, vanaf de
 *  vorige waarde als alleen de cijfers ververst zijn. */
function CountUp({ value, k }: { value: number; k: string }) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const from = lastKey.current === k ? shownRef.current : 0;
    lastKey.current = k;
    const start = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const v = from + (value - from) * (1 - Math.pow(1 - p, 3));
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [k, value]);
  return <>{fmt(shown)}</>;
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  if (!now) return null;
  return (
    <span>
      {now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}
      {" · "}
      {now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}
    </span>
  );
}

type Slot = { item: ScreenReelItem; nonce: number } | null;

/** Eerste video en de video daarna (voor het opstarten van het scherm). */
function startSlots(items: ScreenReelItem[]): [Slot, Slot] {
  if (!items.length) return [null, null];
  const first = items[nextIndex(items, new Map(), null)];
  const rest = items.filter((i) => i.key !== first.key);
  const second = rest.length ? rest[nextIndex(rest, new Map(), first.clientId)] : null;
  return [{ item: first, nonce: 1 }, second ? { item: second, nonce: 2 } : null];
}

export function ReelPlayer({ initialReel, initialTotals, initialClientCount }: Props) {
  const [items, setItems] = useState<ScreenReelItem[]>(initialReel.items);
  const [totals, setTotals] = useState(initialTotals);
  const [clientCount, setClientCount] = useState(initialClientCount);
  const [metricsDate, setMetricsDate] = useState(initialReel.metricsDate);
  const [authLost, setAuthLost] = useState(false);

  const [slots, setSlots] = useState<[Slot, Slot]>(() => startSlots(initialReel.items));
  const [active, setActive] = useState<0 | 1>(0);
  const [progress, setProgress] = useState(0);
  const [showChrome, setShowChrome] = useState(false);

  const videoEls = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const itemsRef = useRef(items);
  const lastShown = useRef(new Map<string, number>());
  const failedAt = useRef(new Map<string, number>());
  const counter = useRef(0);
  const nonce = useRef(2);
  const playStartedAt = useRef(0);
  const lastProgressAt = useRef(0);
  const lastTime = useRef(0);
  const switching = useRef(false);
  const activeRef = useRef<0 | 1>(0);
  const slotsRef = useRef(slots);
  // Refs synchroon houden met de state, voor timers en video-events.
  useLayoutEffect(() => {
    itemsRef.current = items;
    activeRef.current = active;
    slotsRef.current = slots;
  }, [items, active, slots]);

  /** Kies de volgende video: andere klant dan net, langst niet getoond, niet recent gefaald. */
  const choose = useCallback((prevClientId: string | null, exclude: string | null): ScreenReelItem | null => {
    const now = Date.now();
    const pool = itemsRef.current.filter(
      (i) => i.key !== exclude && now - (failedAt.current.get(i.key) ?? 0) > FAIL_PAUSE_MS,
    );
    if (!pool.length) return null;
    const idx = nextIndex(pool, lastShown.current, prevClientId);
    return pool[idx] ?? null;
  }, []);

  const loadInto = useCallback((slotIdx: 0 | 1, item: ScreenReelItem | null) => {
    setSlots((prev) => {
      const next: [Slot, Slot] = [prev[0], prev[1]];
      next[slotIdx] = item ? { item, nonce: ++nonce.current } : null;
      return next;
    });
  }, []);

  // De eerste video telt als getoond.
  useEffect(() => {
    const first = slotsRef.current[0];
    if (first && !lastShown.current.has(first.item.key)) lastShown.current.set(first.item.key, ++counter.current);
  }, []);

  /** Naar de volgende video (na afloop, fout of vastloper). */
  const advance = useCallback(
    (reason: "ended" | "error" | "stall" | "max" | "skip") => {
      if (switching.current) return;
      const cur = slotsRef.current[activeRef.current];
      if (cur && (reason === "error" || reason === "stall")) failedAt.current.set(cur.item.key, Date.now());

      const other: 0 | 1 = activeRef.current === 0 ? 1 : 0;
      let upcoming = slotsRef.current[other];
      // Is de klaargezette video intussen gefaald of leeg? Kies opnieuw.
      if (!upcoming || Date.now() - (failedAt.current.get(upcoming.item.key) ?? 0) < FAIL_PAUSE_MS) {
        const pick = choose(cur?.item.clientId ?? null, cur?.item.key ?? null);
        if (!pick) {
          // Niets anders beschikbaar: huidige opnieuw starten.
          const v = videoEls.current[activeRef.current];
          if (v) {
            v.currentTime = 0;
            void v.play().catch(() => {});
          }
          return;
        }
        loadInto(other, pick);
        upcoming = { item: pick, nonce: nonce.current };
      }

      switching.current = true;
      lastShown.current.set(upcoming.item.key, ++counter.current);
      const nextVideo = videoEls.current[other];
      if (nextVideo) {
        try {
          nextVideo.currentTime = 0;
        } catch {
          /* nog niet geladen */
        }
        void nextVideo.play().catch(() => {});
      }
      setActive(other);
      setProgress(0);
      playStartedAt.current = Date.now();
      lastProgressAt.current = Date.now();
      lastTime.current = 0;

      // Na de overgang: oude laag stoppen en de daaropvolgende video alvast laden.
      const leaving = activeRef.current;
      window.setTimeout(() => {
        const old = videoEls.current[leaving];
        if (old) old.pause();
        loadInto(leaving, choose(upcoming!.item.clientId, upcoming!.item.key));
        switching.current = false;
      }, FADE_MS + 100);
    },
    [choose, loadInto],
  );

  // Actieve video afspelen zodra die wisselt.
  useEffect(() => {
    const v = videoEls.current[active];
    if (!v) return;
    playStartedAt.current = Date.now();
    lastProgressAt.current = Date.now();
    void v.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slots[active]?.nonce]);

  // Waakhond: vastgelopen of te lange video's overslaan.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!slotsRef.current[activeRef.current] || switching.current) return;
      const now = Date.now();
      if (now - lastProgressAt.current > STALL_MS) advance("stall");
      else if (now - playStartedAt.current > MAX_PLAY_MS) advance("max");
    }, 2000);
    return () => window.clearInterval(id);
  }, [advance]);

  // Data verversen zonder herladen.
  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/scherm/reel", { cache: "no-store" });
        if (res.status === 401) {
          setAuthLost(true);
          return;
        }
        if (!res.ok) return;
        const d = (await res.json()) as { reel: ScreenReel; totals: Totals; clientCount: number };
        if (stopped) return;
        setAuthLost(false);
        if (d.reel.items.length) {
          setItems(d.reel.items);
          if (!slotsRef.current[0] && !slotsRef.current[1]) {
            const [a, b] = startSlots(d.reel.items);
            nonce.current += 2;
            setSlots([a && { ...a, nonce: nonce.current - 1 }, b && { ...b, nonce: nonce.current }]);
            setActive(0);
          }
        }
        setMetricsDate(d.reel.metricsDate);
        setTotals(d.totals);
        setClientCount(d.clientCount);
        // Cijfers van de video's die nu klaarstaan meteen bijwerken.
        const byKey = new Map(d.reel.items.map((i) => [i.key, i]));
        setSlots((prev) => [
          prev[0] && byKey.has(prev[0].item.key) ? { ...prev[0], item: { ...byKey.get(prev[0].item.key)! } } : prev[0],
          prev[1] && byKey.has(prev[1].item.key) ? { ...prev[1], item: { ...byKey.get(prev[1].item.key)! } } : prev[1],
        ]);
      } catch {
        /* netwerkhapering: volgende ronde opnieuw */
      }
    };
    const id = window.setInterval(pull, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  // Scherm wakker houden.
  useEffect(() => {
    type WakeLock = { release: () => Promise<void> };
    let lock: WakeLock | null = null;
    const request = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } }).wakeLock;
        if (wl && document.visibilityState === "visible") lock = await wl.request("screen");
      } catch {
        /* niet ondersteund */
      }
    };
    void request();
    const onVis = () => void request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Eén keer per nacht volledig verversen (nieuwe versie van het portaal, geheugen
  // schoon), alleen als het scherm al lang draait.
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      const h = Number(new Date().toLocaleString("nl-NL", { hour: "numeric", hour12: false, timeZone: "Europe/Amsterdam" }));
      if (h === 5 && Date.now() - started > 12 * 3600_000) window.location.reload();
    }, 10 * 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Muis verbergen; 'Schermvullend' alleen tonen bij bewegen. Pijltje rechts = volgende.
  useEffect(() => {
    let t = 0;
    const onMove = () => {
      setShowChrome(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setShowChrome(false), 3000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") advance("skip");
      if (e.key === "f") void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [advance]);

  const current = slots[active]?.item ?? null;
  const upNext = slots[active === 0 ? 1 : 0]?.item ?? null;

  const interactions = useMemo(() => (current ? current.shares + current.saves : 0), [current]);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        padding: "2.2vh 3vw",
        gap: "2vh",
        cursor: showChrome ? "default" : "none",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes sc-in { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        .sc-in { animation: sc-in ${FADE_MS}ms cubic-bezier(.2,.7,.2,1) both }
      `}</style>

      {/* Kop */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1.2vw" }}>
          <span style={{ fontSize: "clamp(22px,2.2vw,44px)", fontWeight: 800, letterSpacing: "-0.02em" }}>Shortclips</span>
          <span style={{ fontSize: "clamp(14px,1.2vw,24px)", fontWeight: 500, color: MUTED }}>Resultaten van onze klanten</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", fontSize: "clamp(13px,1vw,20px)", color: MUTED }}>
          <Clock />
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
            style={{
              opacity: showChrome ? 1 : 0,
              transition: "opacity 300ms",
              pointerEvents: showChrome ? "auto" : "none",
              background: "transparent",
              color: "#fff",
              border: `1px solid ${LINE}`,
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Schermvullend
          </button>
        </div>
      </header>

      {/* Video + cijfers */}
      {current ? (
        <main style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4vw", minHeight: 0, alignItems: "center" }}>
          {/* Video, 9:16 */}
          <div
            style={{
              position: "relative",
              height: "100%",
              maxHeight: "78vh",
              aspectRatio: "9 / 16",
              borderRadius: "1.6vh",
              overflow: "hidden",
              background: "#000",
              boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
              border: `1px solid ${LINE}`,
            }}
          >
            {([0, 1] as const).map((i) => {
              const s = slots[i];
              return s ? (
                <video
                  key={s.nonce}
                  ref={(el) => {
                    videoEls.current[i] = el;
                  }}
                  src={s.item.playSrc}
                  poster={s.item.posterSrc}
                  muted
                  playsInline
                  preload="auto"
                  autoPlay={i === active}
                  onEnded={() => i === activeRef.current && advance("ended")}
                  onError={() => {
                    if (i === activeRef.current) advance("error");
                    else failedAt.current.set(s.item.key, Date.now());
                  }}
                  onTimeUpdate={(e) => {
                    if (i !== activeRef.current) return;
                    const v = e.currentTarget;
                    if (v.currentTime !== lastTime.current) {
                      lastTime.current = v.currentTime;
                      lastProgressAt.current = Date.now();
                    }
                    if (v.duration) setProgress(v.currentTime / v.duration);
                  }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    opacity: i === active ? 1 : 0,
                    transition: `opacity ${FADE_MS}ms ease`,
                  }}
                />
              ) : null;
            })}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 5, background: "rgba(255,255,255,0.18)" }}>
              <div style={{ height: "100%", width: `${progress * 100}%`, background: "#fff", transition: "width 250ms linear" }} />
            </div>
          </div>

          {/* Cijfers */}
          <section key={slots[active]?.nonce} className="sc-in" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3.2vh" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "clamp(12px,0.95vw,19px)",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    background: "#fff",
                    color: NAVY,
                    borderRadius: 999,
                    padding: "0.45vh 0.9vw",
                  }}
                >
                  {REASON_LABEL[current.reason]}
                </span>
                {current.reason === "uitschieter" && current.relative >= 2 ? (
                  <span style={{ fontSize: "clamp(13px,1.05vw,21px)", color: MUTED }}>
                    {current.relative.toLocaleString("nl-NL")}× zoveel weergaven als normaal bij deze klant
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  marginTop: "1.6vh",
                  fontSize: "clamp(34px,4.4vw,92px)",
                  fontWeight: 800,
                  lineHeight: 1.02,
                  letterSpacing: "-0.025em",
                }}
              >
                {current.clientName}
              </div>
              {current.title ? (
                <div
                  style={{
                    marginTop: "1.2vh",
                    fontSize: "clamp(16px,1.6vw,32px)",
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.85)",
                    lineHeight: 1.3,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    maxWidth: "48vw",
                  }}
                >
                  {current.title}
                </div>
              ) : null}
              <div style={{ marginTop: "1vh", fontSize: "clamp(13px,1.1vw,22px)", color: MUTED }}>
                Online sinds {shortDate(current.publishedAt)} · {current.platforms.map((p) => PLATFORM_LABEL[p.platform] ?? p.platform).join(", ")}
              </div>
            </div>

            {/* Weergaven groot */}
            <div>
              <div style={{ fontSize: "clamp(13px,1.1vw,22px)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED }}>
                Weergaven
              </div>
              <div style={{ fontSize: "clamp(64px,9.5vw,200px)", fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}>
                <CountUp value={current.views} k={`${slots[active]?.nonce}`} />
              </div>
              {current.platforms.length > 1 ? (
                <div style={{ marginTop: "1vh", display: "flex", gap: "1.6vw", flexWrap: "wrap", fontSize: "clamp(13px,1.1vw,22px)", color: MUTED }}>
                  {current.platforms.map((p) => (
                    <span key={p.platform}>
                      {PLATFORM_LABEL[p.platform] ?? p.platform}{" "}
                      <strong style={{ color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt(p.views)}</strong>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Overige cijfers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "1.2vw", maxWidth: "52vw" }}>
              {[
                { label: "Likes", value: current.likes },
                { label: "Reacties", value: current.comments },
                { label: "Gedeeld & bewaard", value: interactions },
              ].map((s) => (
                <div key={s.label} style={{ border: `1px solid ${LINE}`, background: "rgba(255,255,255,0.04)", borderRadius: "1.4vh", padding: "1.8vh 1.4vw" }}>
                  <div style={{ fontSize: "clamp(12px,0.95vw,19px)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED }}>{s.label}</div>
                  <div style={{ marginTop: 4, fontSize: "clamp(30px,3.6vw,76px)", fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
                    <CountUp value={s.value} k={`${slots[active]?.nonce}-${s.label}`} />
                  </div>
                </div>
              ))}
            </div>

            {upNext ? (
              <div style={{ fontSize: "clamp(13px,1vw,20px)", color: MUTED }}>
                Hierna: <span style={{ color: "#fff", fontWeight: 600 }}>{upNext.clientName}</span>
              </div>
            ) : null}
          </section>
        </main>
      ) : (
        <main style={{ display: "grid", placeItems: "center", textAlign: "center", color: MUTED, fontSize: "clamp(18px,1.6vw,30px)" }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "clamp(24px,2.4vw,44px)" }}>Video&apos;s worden geladen</div>
            <div style={{ marginTop: 10 }}>
              {items.length === 0
                ? "Er zijn nog geen gepubliceerde video's die met zekerheid aan een Frame-bestand gekoppeld zijn."
                : "Een moment geduld."}
            </div>
          </div>
        </main>
      )}

      {/* Periodecijfers */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "2vw",
          borderTop: `1px solid ${LINE}`,
          paddingTop: "1.6vh",
          fontSize: "clamp(13px,1.1vw,22px)",
          color: MUTED,
        }}
      >
        <div style={{ display: "flex", gap: "2.6vw", flexWrap: "wrap" }}>
          <span>Laatste 30 dagen</span>
          <span>
            <strong style={{ color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt(totals.views)}</strong> weergaven
            {totals.viewsGrowthPct !== null ? (
              <span style={{ marginLeft: 8, color: totals.viewsGrowthPct >= 0 ? "#7ee2a8" : "#ff9a9a" }}>
                {totals.viewsGrowthPct >= 0 ? "+" : "−"}
                {Math.abs(totals.viewsGrowthPct)}%
              </span>
            ) : null}
          </span>
          <span>
            <strong style={{ color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt(totals.reach)}</strong> bereik
          </span>
          <span>
            <strong style={{ color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt(totals.posts)}</strong> shorts online
          </span>
          <span>
            <strong style={{ color: "#fff", fontVariantNumeric: "tabular-nums" }}>{clientCount}</strong> klanten
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          {authLost
            ? "Sessie verlopen: log opnieuw in om de cijfers bij te werken"
            : metricsDate
              ? `Cijfers bijgewerkt t/m ${shortDate(metricsDate)}`
              : null}
        </div>
      </footer>
    </div>
  );
}
