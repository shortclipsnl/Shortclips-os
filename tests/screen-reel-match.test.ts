import { describe, expect, it } from "vitest";
import {
  assetWords,
  groupPublications,
  matchVideosToAssets,
  nextIndex,
  pickReel,
  type ReelAsset,
  type ReelPublication,
} from "@/lib/screen-reel-match";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
let n = 0;
const pub = (p: Partial<ReelPublication>): ReelPublication => ({
  id: `p${++n}`, clientId: "marco", platform: "instagram", publishedAt: d("2026-11-10"), durationSeconds: null,
  caption: "", externalUrl: null, views: 1000, reach: 0, likes: 10, comments: 1, shares: 0, saves: 0, ...p,
});
const asset = (a: Partial<ReelAsset>): ReelAsset => ({
  id: `a${++n}`, clientId: "marco", name: "x.mp4", subfolderName: null, durationSeconds: 30, frameCreatedAt: d("2026-11-01"), ...a,
});

describe("kantoorscherm: posts aan Frame-video's koppelen", () => {
  it("haalt onderwerpwoorden uit de bestandsnaam", () => {
    expect(assetWords("1 - PORSCHE 911 GT3 - Shortclips_V3.mp4")).toEqual(["porsche", "911", "gt3"]);
  });

  it("voegt dezelfde video op meerdere platforms samen en telt de cijfers op", () => {
    const vids = groupPublications([
      pub({ platform: "tiktok", durationSeconds: 41, caption: "Nieuw kostte deze Porsche 911 GT3 maar liefst", views: 5000 }),
      pub({ platform: "instagram", caption: "Nieuw kostte deze Porsche 911 GT3 maar liefst! #porsche", views: 3000 }),
      pub({ platform: "instagram", caption: "Iets heel anders over een Audi RS3", publishedAt: d("2026-11-11") }),
    ]);
    expect(vids).toHaveLength(2);
    const gt3 = vids.find((v) => v.caption.includes("GT3"))!;
    expect(gt3.views).toBe(8000);
    expect(gt3.durationSeconds).toBe(41);
  });

  it("koppelt op duur + onderwerp en kiest de nieuwste versie", () => {
    const vids = groupPublications([pub({ durationSeconds: 41, caption: "Nieuw kostte deze Porsche 911 GT3 maar liefst €305.000" })]);
    const v3 = asset({ name: "1 - PORSCHE 911 GT3 - Shortclips_V3.mp4", durationSeconds: 41, frameCreatedAt: d("2026-10-21") });
    const v2 = asset({ name: "1 - PORSCHE 911 GT3 - Shortclips_V2.mp4", durationSeconds: 41, frameCreatedAt: d("2026-10-18") });
    const other = asset({ name: "2 - MERCEDES SL43 AMG - Shortclips.mp4", durationSeconds: 41 });
    const m = matchVideosToAssets(vids, [v2, other, v3]);
    expect(m).toHaveLength(1);
    expect(m[0].asset.id).toBe(v3.id);
  });

  it("koppelt niet bij twijfel (zelfde duur, geen onderwerp, meerdere kandidaten)", () => {
    const vids = groupPublications([pub({ durationSeconds: 33, caption: "Welke zou jij nemen?" })]);
    const m = matchVideosToAssets(vids, [asset({ name: "A.mp4", durationSeconds: 33 }), asset({ name: "B.mp4", durationSeconds: 33 })]);
    expect(m).toHaveLength(0);
  });

  it("koppelt nooit een video van een andere klant of een bestand van ná publicatie", () => {
    const vids = groupPublications([pub({ durationSeconds: 41, caption: "Porsche 911 GT3" })]);
    const m = matchVideosToAssets(vids, [
      asset({ clientId: "luxewagen", name: "PORSCHE 911 GT3.mp4", durationSeconds: 41 }),
      asset({ name: "PORSCHE 911 GT3.mp4", durationSeconds: 41, frameCreatedAt: d("2026-11-20") }),
    ]);
    expect(m).toHaveLength(0);
  });
});

describe("kantoorscherm: selectie en volgorde", () => {
  it("toont meerdere klanten en niet twee keer achter elkaar dezelfde klant", () => {
    const vids = groupPublications([
      ...[1, 2, 3, 4].map((i) => pub({ clientId: "groot", caption: `video ${i} onderwerp${i}`, publishedAt: d(`2026-10-0${i}`), views: 100000 * i })),
      pub({ clientId: "klein", caption: "klein onderwerp", views: 800 }),
    ]);
    const matches = vids.map((v, i) => ({ video: v, asset: asset({ clientId: v.clientId, id: `x${i}` }), score: 5, matchedWords: [] }));
    const reel = pickReel(matches, { perClient: 3, now: d("2026-11-11") });
    expect(reel.map((r) => r.video.clientId)).toContain("klein");
    const items = reel.map((r) => ({ key: r.video.key, clientId: r.video.clientId }));
    const i = nextIndex(items, new Map(), "groot");
    expect(items[i].clientId).toBe("klein");
  });
});
