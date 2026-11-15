import { describe, expect, it } from "vitest";
import { matchTranscripts, type MatchVideo } from "@/lib/transcript-match";

const d = (s: string) => new Date(`${s}T10:00:00Z`);
const videos: MatchVideo[] = [
  { key: "q7", caption: "€35.000 BUDGET en veel snellere kilometers? Dan is deze Audi perfect!\nZou jij deze Audi Q7 kiezen?\n📍 | Sneek\n#audi #occasion", publishedAt: d("2026-10-10"), durationSeconds: 31 },
  { key: "tesla", caption: "Is de Tesla Roadster toch niet helemaal jouw ding? Geen probleem, er is genoeg andere keuze!\n📍 | Sneek", publishedAt: d("2026-10-14"), durationSeconds: 18 },
  { key: "recreatie", caption: "Vanaf € 400.000: 1 straat, 5 recreatiewoningen. Ze staan allemaal in de verkoop aan het water in Stavoren, met eigen aanlegsteiger en uitzicht over het IJsselmeer.", publishedAt: d("2026-10-20"), durationSeconds: null },
  { key: "penthouse", caption: "Wat kost wonen met dit uitzicht in Friesland? Aan de Swurdkade vind je dit luxe penthouse met dakterras en lift.", publishedAt: d("2026-10-22"), durationSeconds: null },
];

describe("transcript koppelen aan publicatie", () => {
  it("koppelt op duur als er precies één video met die duur is", () => {
    const [m] = matchTranscripts(videos, [{ id: "a1", transcript: "Heb jij last van autovrees en wil je niet over de kop vliegen", durationSeconds: 17.9, createdAt: d("2026-10-01") }]);
    expect(m?.videoKey).toBe("tesla");
  });

  it("koppelt zonder duur op wat er gezegd wordt", () => {
    const [m] = matchTranscripts(videos, [{ id: "a2", transcript: "Vanaf 400.000 euro, één straat, vijf recreatiewoningen. Ze staan allemaal in de verkoop aan het water in Stavoren met een eigen aanlegsteiger en uitzicht over het IJsselmeer.", durationSeconds: 25.6, createdAt: d("2026-10-05") }]);
    expect(m?.videoKey).toBe("recreatie");
    expect(m!.shared.length).toBeGreaterThanOrEqual(4);
  });

  it("koppelt niet bij twijfel", () => {
    const res = matchTranscripts(videos, [{ id: "a3", transcript: "Welkom bij ons op kantoor, vandaag laten we zien hoe een gewone werkdag eruit ziet voor het hele team.", durationSeconds: 52, createdAt: d("2026-10-05") }]);
    expect(res).toHaveLength(0);
  });

  it("koppelt een bestand niet aan een publicatie van vóór het bestand", () => {
    const res = matchTranscripts(videos, [{ id: "a4", transcript: "Heb jij last van autovrees", durationSeconds: 18, createdAt: d("2026-11-10") }]);
    expect(res).toHaveLength(0);
  });

  it("geeft één video aan hooguit één bestand", () => {
    const t = "Vanaf 400.000 euro, één straat, vijf recreatiewoningen in de verkoop aan het water in Stavoren met aanlegsteiger en uitzicht over het IJsselmeer.";
    const res = matchTranscripts(videos, [{ id: "x", transcript: t, durationSeconds: 25, createdAt: d("2026-10-05") }, { id: "y", transcript: t + " Bel ons.", durationSeconds: 26, createdAt: d("2026-10-06") }]);
    expect(res).toHaveLength(1);
  });
});
