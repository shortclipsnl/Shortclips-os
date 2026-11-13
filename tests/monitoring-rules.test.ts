import { describe, expect, it } from "vitest";
import {
  CRITICAL_GRACE_MS,
  digestContent,
  digestDue,
  isRecurring,
  levelFromAge,
  nextRecoveryDelay,
  recordRecovery,
  recoveryDue,
  redact,
  stepIncidents,
  worstLevel,
  type Incident,
  type Observation,
} from "@/lib/monitoring-rules";

const MIN = 60_000;
const t0 = new Date("2026-11-13T10:00:00Z");
const at = (mins: number) => new Date(t0.getTime() + mins * MIN);

function obs(level: Observation["level"], extra: Partial<Observation> = {}): Observation {
  return { key: "frameio", name: "Frame.io", level, summary: "s", action: null, needsHuman: false, retryable: true, core: true, ...extra };
}

describe("Koppelingsbewaking: statusbepaling", () => {
  it("bereikbaar maar geen verse data is oranje/rood, niet groen", () => {
    const f = { warnAfterMs: 2 * 60 * MIN, downAfterMs: 4 * 60 * MIN };
    expect(levelFromAge(at(-30), t0, f)).toBe("ok");
    expect(levelFromAge(at(-180), t0, f)).toBe("warn");
    expect(levelFromAge(at(-300), t0, f)).toBe("down");
    expect(levelFromAge(null, t0, f)).toBe("down");
  });

  it("slechtste status wint; niet ingesteld telt niet als storing", () => {
    expect(worstLevel(["ok", "warn", "off"])).toBe("warn");
    expect(worstLevel(["ok", "down", "warn"])).toBe("down");
    expect(worstLevel(["off", "off"])).toBe("off");
  });
});

describe("Koppelingsbewaking: tijdelijke uitval en herstel", () => {
  it("1-3: storing wordt opgemerkt, hersteld met oplopende wachttijd, zonder melding", () => {
    // Ronde 1: Frame.io valt uit.
    let s = stepIncidents({}, [obs("down")], t0);
    expect(Object.keys(s.open)).toEqual(["frameio"]);
    expect(s.notifyCritical).toHaveLength(0); // nog binnen de wachttijd

    // Herstelpoging mag direct, daarna pas na 15 minuten.
    expect(recoveryDue(s.open.frameio, obs("down"), t0)).toBe(true);
    const afterTry = recordRecovery(s.open.frameio!, false, t0);
    expect(recoveryDue(afterTry, obs("down"), at(10))).toBe(false);
    expect(recoveryDue(afterTry, obs("down"), at(16))).toBe(true);
    expect(nextRecoveryDelay(0)).toBe(15 * MIN);
    expect(nextRecoveryDelay(1)).toBe(30 * MIN);
    expect(nextRecoveryDelay(3)).toBe(120 * MIN);
    expect(nextRecoveryDelay(10)).toBe(240 * MIN);

    // 4: na herstel is alles weer groen, automatisch opgelost, geen melding.
    s = stepIncidents({ frameio: afterTry }, [obs("ok")], at(16));
    expect(s.open).toEqual({});
    expect(s.resolved[0]!.autoResolved).toBe(true);
    expect(s.notifyRecovered).toHaveLength(0);
  });

  it("5: kritieke melding pas als herstel niet lukt (na de wachttijd), en maar één keer", () => {
    const first = stepIncidents({}, [obs("down")], t0);
    const later = stepIncidents(first.open, [obs("down")], new Date(t0.getTime() + CRITICAL_GRACE_MS));
    expect(later.notifyCritical.map((i) => i.key)).toEqual(["frameio"]);
    const again = stepIncidents(later.open, [obs("down")], at(60));
    expect(again.notifyCritical).toHaveLength(0);
    // Hersteld na melding: één 'hersteld'-bericht.
    const back = stepIncidents(again.open, [obs("ok")], at(90));
    expect(back.notifyRecovered.map((i) => i.key)).toEqual(["frameio"]);
    expect(back.resolved[0]!.autoResolved).toBe(false);
  });

  it("toestemming ingetrokken: direct melden, geen automatische herstelpoging", () => {
    const o = obs("down", { key: "google_drive", name: "Google Drive", needsHuman: true });
    const s = stepIncidents({}, [o], t0);
    expect(s.notifyCritical.map((i) => i.key)).toEqual(["google_drive"]);
    expect(recoveryDue(s.open.google_drive, o, t0, true)).toBe(false);
  });

  it("geen kritieke melding voor niet-kernkoppelingen of oranje", () => {
    const s1 = stepIncidents({}, [obs("down", { key: "metricool", core: false })], t0);
    const s2 = stepIncidents(s1.open, [obs("down", { key: "metricool", core: false })], at(120));
    expect(s2.notifyCritical).toHaveLength(0);
    const w1 = stepIncidents({}, [obs("warn")], t0);
    const w2 = stepIncidents(w1.open, [obs("warn")], at(120));
    expect(w2.notifyCritical).toHaveLength(0);
  });

  it("oranje dat verergert naar rood blijft hetzelfde incident", () => {
    const a = stepIncidents({}, [obs("warn")], t0);
    const b = stepIncidents(a.open, [obs("down")], at(45));
    expect(b.open.frameio!.openedAt).toBe(t0.toISOString());
    expect(b.notifyCritical).toHaveLength(1); // al > 30 min open
  });
});

describe("Koppelingsbewaking: terugkerend en dagoverzicht", () => {
  const hist = (n: number): Incident[] =>
    Array.from({ length: n }, (_, i) => ({
      key: "google_calendar", name: "Google Agenda", level: "down", summary: "", action: null, needsHuman: false, core: true,
      openedAt: at(-60 * 24 * (i + 1)).toISOString(), lastSeenAt: at(-60 * 24 * (i + 1) + 30).toISOString(),
      recoveryAttempts: 1, lastRecoveryAt: null, lastRecoveryOk: true, nextRecoveryAt: null, criticalNotifiedAt: null,
      resolvedAt: at(-60 * 24 * (i + 1) + 30).toISOString(), autoResolved: true,
    }));

  it("3x in 7 dagen is terugkerend", () => {
    expect(isRecurring("google_calendar", hist(2), false, t0)).toBe(false);
    expect(isRecurring("google_calendar", hist(2), true, t0)).toBe(true);
    expect(isRecurring("google_calendar", hist(3), false, t0)).toBe(true);
  });

  it("dagoverzicht alleen als er iets was, één keer per dag vanaf 08:00", () => {
    expect(digestContent({}, [], t0)).toBeNull();
    const c = digestContent({}, hist(1).map((h) => ({ ...h, resolvedAt: at(-60).toISOString() })), t0);
    expect(c?.autoResolved).toHaveLength(1);
    expect(digestDue(null, new Date("2026-11-13T06:30:00Z"))).toBe(false); // 07:30 NL
    expect(digestDue(null, new Date("2026-11-13T07:05:00Z"))).toBe(true); // 08:05 NL
    expect(digestDue("2026-11-13", new Date("2026-11-13T09:00:00Z"))).toBe(false);
  });
});

describe("Koppelingsbewaking: veiligheid van meldingen", () => {
  it("haalt tokens en sleutels uit tekst die naar buiten gaat", () => {
    const out = redact("Fout: refresh_token=1//0gAbCdEfGhIjKlMnOpQrStUvWxYz123 en ya29.a0AfH6SMBx en key abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    expect(out).not.toContain("1//0gAbCdEf");
    expect(out).not.toContain("ya29.a0");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789ABCD");
  });
});
