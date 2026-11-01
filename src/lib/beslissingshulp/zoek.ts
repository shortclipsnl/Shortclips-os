/**
 * Zoeken in de Beslissingshulp, gebouwd voor snel en slordig typen:
 * - typfouten: woorden die 1 (of bij lange woorden 2) letters afwijken tellen mee
 * - spreektaal en namen: synoniemen vertalen "klant gaat weg" naar "stoppen"
 * - zeldzame woorden wegen zwaarder dan algemene ("klant", "video")
 */
import type { Situatie } from "./data";

export function normaliseer(t: string): string {
  return t
    .replace(/\[\[(.+?)\]\]/g, "$1")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/'s\b/g, "s")
    .replace(/[^a-z0-9€ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "klant", "de", "het", "een", "is", "van", "op", "te", "en", "met", "voor", "naar", "er", "mijn",
  "we", "ik", "die", "dat", "wil", "wilt", "willen", "kan", "kun", "moet", "nog", "al", "ook", "ze",
  "hij", "zij", "je", "jij", "wat", "hoe", "doen", "doe", "heeft", "hebben", "bij", "om", "in", "aan",
  "n", "m", "t", "s", "eh", "nu", "even", "graag", "dan", "maar", "of", "dit", "deze", "zo",
  "niet", "geen", "morgen", "vandaag", "gisteren", "weer", "echt", "heel", "erg", "wel", "iets", "iemand", "weet",
]);

/** Spreektaal, afkortingen en namen naar woorden die in de situaties staan. */
const SYNONIEMEN: [RegExp, string][] = [
  [/\b(scri?p\w*|vid\w*|onderwerp\w*|filmpje\w*)\b.*\b(weg(?! ?halen)|eruit|schrappen|laten vallen|niet maken)\b|\b(schrap\w*)\b/, "script eruit schrappen"],
  [/\bweg ?halen\b|\boffline\b|\beraf ?halen\b|\bverwijder\w*\b/, "offline weghalen"],
  [/\blelijk\b|\bniet mooi\b|\bkeurt\b.*\baf\b|\bafgekeurd\b|\bniet goed genoeg\b/, "ontevreden afgekeurd"],
  [/\b(opname|draaidag|shoot)\b.*\buitstel\w*|\buitstel\w*\b.*\b(opname|draaidag|shoot)\b/, "verplaatsen"],
  [/\bmontage\b|\bmonteren\b|\bediten\b/, "editor montage"],
  [/\bniet op tijd\b|\bte laat\b|\blater\b/, "te laat"],
  [/\bgaat weg\b|\bwil weg\b|\bhoudt op\b|\bkapt\b|\bkappen\b/, "stoppen"],
  [/^(?!.*\b(videograaf|editor|freelancer|collega|rutger|milou|jiska)\b).*(\bkan\b.*\bniet\b|\bkunnen\b.*\bniet\b)|\bkomt niet\b|\bgaat niet door\b|\bcancel\w*\b|\bannule\w*\b/, "afzeggen verplaatsen"],
  [/\bwas er niet\b|\bniet gekomen\b|\bniet komen opdagen\b|\bniemand\b/, "afwezig"],
  [/\brutger\b|\bcameraman\b|\bfilmer\b/, "videograaf"],
  [/\bmilou\b|\bjiska\b|\bjeska\b/, "collega"],
  [/\bfotos?\b|\bfoto s\b|\bplaatjes\b/, "beelden"],
  [/\bvid\b|\bvids\b|\bfilmpje\w*\b|\bvideootje\b/, "video"],
  [/\bscriptje\w*\b/, "script"],
  [/\bvideo erbij\b|\bnog een video\b|\bextra video\w*\b|\bvideo bij\b/, "extra video bijbestellen"],
  [/\bresultaat\b|\bresultaten\b|\bscoort\b|\bpresteert\b/, "resultaten"],
  [/\bcomments?\b|\bcommentaar\b/, "reacties"],
  [/\bboos\b|\bchagrijnig\b|\bklaagt\b|\bzeurt\b|\bklagen\b/, "ontevreden klacht"],
  [/\bmorgen klaar\b|\bsnel\b|\bvandaag nog\b|\basap\b|\bmorgen al\b/, "spoed sneller"],
  [/\bziek\w*\b|\bkan niet komen\b|\b(videograaf|editor|freelancer|collega|rutger|milou|jiska)\b.*\bkan\b.*\bniet\b/, "ziek uitval"],
  [/\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|datum|deadline|event|beurs)\b/, "vaste datum spoed"],
  [/\bkleiner\b|\bverkleinen\b|\bafschalen\b/, "minder pakket"],
  [/\bgroter\b|\buitbreiden\b|\bopschalen\b/, "meer pakket"],
  [/\bfact\w*\b.*\bkwijt\b|\bkwijt\b.*\bfact\w*\b/, "kopie"],
  [/\b(beelden|bestanden|footage|materiaal|kaart|data)\b.*\bkwijt\b/, "bestanden kwijt beschadigd"],
  [/\bgratis\b|\bcadeau\b|\bvoor niks\b/, "gratis compensatie"],
  [/\bduur\b|\bprijs\b/, "duur korting"],
  [/\bgeld\b/, "geld"],
  [/\bfactuurr?\w*\b|\bfaktuur\b|\brekening\b/, "factuur"],
  [/\bbetaalt? niet\b|\bonbetaald\b|\bopenstaand\w*\b/, "niet betaald"],
  [/\binlog\w*\b|\binloggen\b/, "inloggen portaal"],
  [/\bopzeg\w*\b/, "opzeggen opzegtermijn"],
  [/\bgefilmd\b|\bopgenomen zonder\b/, "toestemming"],
  [/\bweer\b|\bregen\w*\b|\bstorm\b|\bsneeuw\b/, "weer regen"],
  [/\bfout\w*\b/, "fout"],
  [/\bverzet\w*\b|\bverschuiv\w*\b|\bverplaats\w*\b/, "verplaatsen"],
  [/\bgeen reactie\b|\bhoor niks\b|\bhoor niets\b|\breageer\w*\b|\breageert\w*\b|\bantwoordt niet\b|\bstil\b/, "reageert niet reactie"],
  [/\brapport\w*\b|\bcijfers\b|\bstats\b/, "rapportage resultaten"],
  [/\bweet\b.*\b(adres|info|gegevens)\b/, "informatie ontbreekt"],
];

/** Afstand tussen twee woorden (Levenshtein), afgebroken zodra het te groot wordt. */
function afstand(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let vorige = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const rij = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(vorige[j] + 1, rij[j - 1] + 1, vorige[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rij.push(v);
      if (v < min) min = v;
    }
    if (min > max) return max + 1;
    vorige = rij;
  }
  return vorige[b.length];
}

/** Hoe goed past een zoekwoord bij een woord uit een situatie (0 tot 1). */
function pasWoord(w: string, t: string): number {
  if (w === t) return 1;
  if (w.length >= 3 && t.startsWith(w)) return 0.9;
  if (t.length >= 5 && w.startsWith(t) && w.length - t.length <= 2) return 0.85;
  if (w.length >= 5 && t.includes(w)) return 0.8;
  if (w.length >= 4 && t.length >= 4) {
    const max = w.length >= 8 ? 2 : 1;
    if (afstand(w, t, max) <= max) return 0.7;
  }
  return 0;
}

type Index = { s: Situatie; velden: { woorden: string[]; gewicht: number }[]; titel: string }[];

export function maakIndex(situaties: Situatie[]): Index {
  return situaties.map((s) => ({
    s,
    titel: normaliseer(s.titel),
    velden: [
      { woorden: normaliseer(s.titel).split(" "), gewicht: 3 },
      { woorden: normaliseer(s.zoekwoorden).split(" "), gewicht: 2.5 },
      { woorden: normaliseer(`${s.situatie} ${s.waarom}`).split(" "), gewicht: 1 },
    ],
  }));
}

/** Synoniemen tellen voor 80% mee in de score en voor 50% in de dekking (getest op 163 zoekopdrachten). */
const SYN_SCORE = 0.8;
const SYN_DEKKING = 0.5;

export function zoek(index: Index, invoer: string, max = 5): Situatie[] {
  let q = normaliseer(invoer);
  if (!q) return [];
  // "Klant wil eruit" zonder script/video erbij betekent stoppen, niet een script schrappen.
  if (/\beruit\b/.test(q) && !/\b(scri?p\w*|vid\w*|onderwerp\w*|filmpje\w*)\b/.test(q)) {
    q = q.replace(/\beruit\b/g, "stoppen");
  }
  const extra: string[] = [];
  for (const [re, woorden] of SYNONIEMEN) if (re.test(q)) extra.push(woorden);
  const zin = q;
  q = `${q} ${extra.join(" ")}`;

  const getypt = new Set(zin.split(" "));
  const woorden = [...new Set(q.split(" ").filter((w) => w.length > 1 && !STOP.has(w)))];
  if (!woorden.length) return [];

  // Per woord: hoe goed past het bij elke situatie.
  const per = woorden.map((w) =>
    index.map((it) => {
      let best = 0;
      for (const v of it.velden) for (const t of v.woorden) {
        const m = pasWoord(w, t) * v.gewicht;
        if (m > best) best = m;
      }
      return best;
    }),
  );
  // Zeldzame woorden wegen zwaarder; woorden die nergens voorkomen tellen niet mee.
  const N = index.length;
  const gewicht = per.map((col, i) => {
    const df = col.filter((m) => m > 0).length;
    if (df === 0) return 0;
    // Woorden die via een synoniem zijn toegevoegd wegen minder dan wat iemand zelf typte.
    return Math.log(1 + N / df) * (getypt.has(woorden[i]) ? 1 : SYN_SCORE);
  });
  // Dekking meten we over wat iemand zelf typte; synoniemen helpen alleen bij de score.
  const telt = gewicht.map((g, i) => (getypt.has(woorden[i]) ? g : g * SYN_DEKKING));
  const totaal = telt.reduce((a, b) => a + b, 0);
  if (totaal === 0) return [];

  const scores = index.map((it, i) => {
    let score = 0, gedekt = 0;
    per.forEach((col, w) => {
      if (col[i] > 0) { score += col[i] * gewicht[w]; gedekt += telt[w]; }
    });
    if (it.titel.includes(zin)) score += 8;
    return { s: it.s, score, dekking: gedekt / totaal };
  });

  const kandidaten = scores.filter((x) => x.score > 0 && x.dekking >= 0.45).sort((a, b) => b.score - a.score);
  if (!kandidaten.length) return [];
  const top = kandidaten[0].score;
  return kandidaten.filter((x) => x.score >= top * 0.4).slice(0, max).map((x) => x.s);
}
