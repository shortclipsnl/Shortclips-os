"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Lock, Megaphone, Search, Smartphone } from "lucide-react";
import {
  ALTIJD, EXTRA_KOSTEN, GIDS, GIDS_BEIDE, INHOUD, KERNAFSPRAKEN, KLANT_STAPPEN, KLANTVRAGEN, NOG_OPEN, NOOIT,
  OVERIGE_AFSPRAKEN, PAKKETTEN, SPLITSING, STAPPEN, TARIEF, VERSIE, VERWARRING, WIE_BESLIST,
  eur, vul, type ExtraPost, type Spoor, type TariefKey,
} from "@/lib/prijslijst/data";
import s from "./prijslijst.module.css";

/* ------------------------------------------------------------------ */
/* Hulpjes                                                              */
/* ------------------------------------------------------------------ */

const TABS = [
  ["pakketten", "Pakketten"], ["stappen", "Stappen en prijzen"], ["extra", "Extra kosten"],
  ["vragen", "Klantvragen"], ["afspraken", "Interne afspraken"], ["gids", "Snelle prijsgids"],
] as const;
type Tab = (typeof TABS)[number][0];

const isTariefKey = (v: unknown): v is TariefKey => typeof v === "string" && v in TARIEF;

/** **vet** en _cursief_ uit de databron, plus {bedragen}. */
function Rijk({ tekst }: { tekst: string }) {
  const delen = vul(tekst).split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return <>{delen.map((d, i) => d.startsWith("**") ? <b key={i}>{d.slice(2, -2)}</b> : d.startsWith("_") && d.endsWith("_") && d.length > 2 ? <span key={i} className="same">{d.slice(1, -1)}</span> : <Fragment key={i}>{d}</Fragment>)}</>;
}

/** Tekst met [ORG] / [ADS] labels. */
function MetLabel({ tekst }: { tekst: string }) {
  const m = tekst.match(/^(.*?)\s*\[(ORG|ADS)\]$/);
  if (!m) return <>{tekst}</>;
  return <>{m[1]} <span className={`mini ${m[2] === "ORG" ? "org" : "ads"}`}>{m[2]}</span></>;
}

function Prijslabel({ tarief, element = "pp" }: { tarief: ExtraPost["tarief"]; element?: "pp" | "chip" }) {
  if (isTariefKey(tarief)) return <span className={element}>{eur(TARIEF[tarief])}</span>;
  const stijl = { gratis: "free", volledig: "pct", neutraal: "mut", niet: "ni" }[tarief.stijl ?? "neutraal"];
  return <span className={`${element} ${stijl}`}>{tarief.stijl === "niet" ? "NIET INBEGREPEN" : tarief.tekst}</span>;
}

function SpoorLabel({ spoor }: { spoor?: Spoor | "beide" }) {
  if (!spoor) return null;
  return <span className={`trk ${spoor === "beide" ? "both" : spoor}`}>{spoor === "org" ? "Organisch" : spoor === "ads" ? "Advertenties" : "Beide"}</span>;
}

function NogOpen({ prefix }: { prefix: string }) {
  return (
    <div className="openbox">
      <h3>Nog niet vastgesteld</h3>
      {NOG_OPEN.map(([a, b], i) => <div className="openrow" id={`${prefix}-${i}`} key={a}><b>{a}</b><span>{b}</span></div>)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Zoekindex                                                            */
/* ------------------------------------------------------------------ */

type Hit = { t: string; s: string; v: string; tab: Tab; id: string; x?: string; b?: number };
const plat = (t: string) => vul(t).replace(/\*\*|_|\[(ORG|ADS)\]/g, "");
const tariefTekst = (t: ExtraPost["tarief"]) => isTariefKey(t) ? eur(TARIEF[t]) : t.tekst;

function bouwIndex(): Hit[] {
  const I: Hit[] = [];
  PAKKETTEN.forEach((p) => I.push({ t: p.naam, s: `Pakketten · ${p.spoor === "org" ? "Organisch" : "Advertenties"} · ${p.eenheid} · ${p.n1} ${p.l1}${p.spoor === "ads" ? " · per maand of per ronde nog niet vastgesteld" : ""}`, v: eur(TARIEF[p.id]), tab: "pakketten", id: `pk-${p.id}`, b: 3 }));
  (["org", "ads"] as Spoor[]).forEach((sp) => {
    const nm = sp === "org" ? "Organisch" : "Advertenties", c = INHOUD[sp];
    c.ja.forEach((r, i) => I.push({ t: r.t, s: `${nm} · inbegrepen${r.s ? " · " + r.s : ""}`, v: "Inbegrepen", tab: "pakketten", id: `inc-${sp}-ja-${i}`, x: "wat zit erin" }));
    c.nee.forEach((r, i) => I.push({ t: r.t, s: `${nm} · niet inbegrepen${r.s ? " · " + plat(r.s) : ""}`, v: "Niet inbegrepen", tab: "pakketten", id: `inc-${sp}-nee-${i}`, x: "wat zit erin" }));
    c.weten.forEach((r, i) => I.push({ t: r.k, s: `${nm} · ${plat(r.v)}`, v: "", tab: "pakketten", id: `kv-${sp}-${i}` }));
  });
  VERWARRING.forEach((r, i) => I.push({ t: "Verschil: " + r.vraag, s: r.beide ? plat(r.org) : `Organisch: ${plat(r.org)} · Ads: ${plat(r.ads ?? "")}`, v: "", tab: "pakketten", id: `vs-${i}`, x: "organisch advertenties verschil", b: 1 }));
  STAPPEN.forEach((st, i) => I.push({ t: `Stap ${i + 1}: ${st.titel}`, s: `${st.termijn} · ${st.inbegrepen.map(plat).join(", ")}`, v: "", tab: "stappen", id: `st-${i}`, x: st.extra.map((e) => e.wat).join(" ") + " " + st.letop.join(" ") + " termijn deadline" }));
  EXTRA_KOSTEN.forEach((c, ci) => c.regels.forEach((r, ri) => I.push({ t: r.wat, s: `Extra kosten · ${c.categorie} · ${r.wanneer}`, v: tariefTekst(r.tarief), tab: "extra", id: `ex-${ci}-${ri}`, x: "tarief kosten meerwerk " + c.categorie, b: 2 })));
  KLANTVRAGEN.forEach((f, i) => I.push({ t: `"${f.vraag}"`, s: `Klantvragen · ${f.actie}`, v: f.tarief ? eur(TARIEF[f.tarief]) : f.tekst ?? "", tab: "vragen", id: `faq-${i}`, x: f.eenheid }));
  KERNAFSPRAKEN.forEach((a, i) => I.push({ t: a.k, s: `Kernafspraak · ${a.d} · art. ${a.ref}`, v: a.v, tab: "afspraken", id: `kn-${i}`, b: 1 }));
  OVERIGE_AFSPRAKEN.forEach((g, gi) => g.items.forEach((a, ai) => I.push({ t: a.k, s: `Afspraken · ${g.groep} · ${a.d} · ${a.ref}`, v: a.v, tab: "afspraken", id: `ov-${gi}-${ai}` })));
  WIE_BESLIST.forEach((r, i) => I.push({ t: "Wie beslist: " + r[0], s: `Zelf: ${plat(r[1]) || "-"} · Jarno: ${plat(r[2]) || "-"}`, v: "", tab: "afspraken", id: `bs-${i}`, x: "goedkeuring bevoegdheid escalatie", b: 1 }));
  NOG_OPEN.forEach(([a, b], i) => I.push({ t: a, s: "Nog niet vastgesteld · " + b, v: "Open", tab: "pakketten", id: `open-${i}` }));
  return I;
}

/** De prijslijst is statisch, dus de zoekindex wordt één keer opgebouwd. */
const INDEX = bouwIndex();

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const SYN: Record<string, string> = { annuleren: "annuleren verzetten", ruwe: "raw footage", raw: "ruwe beelden", km: "reiskosten", reizen: "reiskosten", revisie: "feedback", aanpassingen: "feedback", spoed: "spoedlevering", opzeggen: "opzeggen looptijd", betalen: "betaaltermijn facturatie", ads: "advertenties", advertentie: "ads" };

function zoek(index: Hit[], q: string): Hit[] {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const exp = terms.map((t) => [t, ...(SYN[t] ? norm(SYN[t]).split(" ") : [])]);
  return index.map((e) => {
    const hay = norm(`${e.t} ${e.s} ${e.v} ${e.x ?? ""}`);
    let sc = e.b ?? 0;
    for (const alts of exp) { if (!alts.some((a) => hay.includes(a))) return null; sc += norm(e.t).includes(alts[0]) ? 3 : 1; }
    return { e, sc };
  }).filter((h): h is { e: Hit; sc: number } => h !== null).sort((a, b) => b.sc - a.sc).slice(0, 12).map((h) => h.e);
}

function Markeer({ tekst, terms }: { tekst: string; terms: string[] }) {
  const t = terms.filter((x) => x.length >= 2);
  if (!t.length) return <>{tekst}</>;
  const re = new RegExp(`(${t.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return <>{tekst.split(re).map((d, i) => i % 2 ? <mark key={i}>{d}</mark> : <Fragment key={i}>{d}</Fragment>)}</>;
}

/* ------------------------------------------------------------------ */
/* Pagina                                                               */
/* ------------------------------------------------------------------ */

export function Prijslijst() {
  const [tab, setTab] = useState<Tab>("pakketten");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const hits = useMemo(() => zoek(INDEX, q), [q]);
  const terms = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const vanHash = () => { const h = window.location.hash.slice(1); if (TABS.some(([id]) => id === h)) setTab(h as Tab); };
    vanHash();
    window.addEventListener("hashchange", vanHash);
    const toets = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener("keydown", toets);
    return () => { window.removeEventListener("hashchange", vanHash); window.removeEventListener("keydown", toets); };
  }, []);

  const kies = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${t}`); };
  const ga = (h: Hit) => {
    setOpen(false); setQ(""); inputRef.current?.blur(); kies(h.tab);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(h.id); if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.closest("details")?.setAttribute("open", "");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    }));
  };

  return (
    <div className={s.root}>
      <div className="head">
        <div>
          <div className="crumb">Sales / Interne prijslijst</div>
          <h1>Interne Prijslijst <span>2027</span></h1>
        </div>
        <div className="badges">
          <span className="badge int"><Lock className="size-3" /> Intern · niet delen met klanten</span>
          <span className="badge">Versie {VERSIE} · geldig vanaf 2027</span>
          <span className="badge">Alle bedragen exclusief btw</span>
        </div>
      </div>

      <div className="bar">
        <nav className="tabs">
          {TABS.map(([id, l], i) => <button key={id} type="button" className={`tab ${tab === id ? "on" : ""}`} onClick={() => kies(id)}><span className="tn">0{i + 1}</span>{l}</button>)}
        </nav>
        <div className="search">
          <Search className="ico size-4" />
          <input ref={inputRef} value={q} placeholder="Zoek tarief of afspraak, bijv. raw footage, annuleren, korting"
            onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => Math.min(v + 1, Math.max(hits.length - 1, 0))); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
              if (e.key === "Enter" && hits[sel]) { e.preventDefault(); ga(hits[sel]); }
              if (e.key === "Escape") { setQ(""); inputRef.current?.blur(); }
            }} />
          <kbd>/</kbd>
          {open && q.trim() ? (
            <div className="results">
              {hits.length ? hits.map((h, i) => (
                <div key={h.id} className={`res ${i === sel ? "sel" : ""}`} onMouseDown={(e) => { e.preventDefault(); ga(h); }}>
                  <span className="t"><Markeer tekst={h.t} terms={terms} /></span>
                  <span className="s"><Markeer tekst={h.s} terms={terms} /></span>
                  <span className="v">{h.v}</span>
                </div>
              )) : <div className="empty">Niets gevonden. Staat het niet in de prijslijst? Geen bedrag noemen, eerst navragen.</div>}
            </div>
          ) : null}
        </div>
      </div>

      {tab === "pakketten" ? <Pakketten /> : null}
      {tab === "stappen" ? <Stappen /> : null}
      {tab === "extra" ? <ExtraKosten /> : null}
      {tab === "vragen" ? <Klantvragen /> : null}
      {tab === "afspraken" ? <Afspraken /> : null}
      {tab === "gids" ? <Gids /> : null}

      <div className="footer"><span>Bron: Shortclips interne prijslijst 2027, versie {VERSIE} definitief</span><span>Alle bedragen exclusief btw · Niet delen met klanten</span></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1 Pakketten                                                          */
/* ------------------------------------------------------------------ */

function Pakketten() {
  return (
    <section>
      <div className="eyebrow">Twee soorten pakketten</div>
      <h2>Organisch of advertenties</h2>
      <p className="sub">Het zijn twee verschillende producten, met een eigen inhoud en eigen tarieven. Check altijd eerst welk pakket de klant heeft.</p>
      <div className="split">
        {(["org", "ads"] as Spoor[]).map((sp) => {
          const d = SPLITSING[sp];
          return (
            <div key={sp} className={`sp ${sp}`}>
              <div className="sh">
                <div className="ico">{sp === "org" ? <Smartphone className="size-5" /> : <Megaphone className="size-5" />}</div>
                <div><div className="sn">{d.naam}</div><div className="sg">{d.doel}</div></div>
              </div>
              <div className="one">{d.kern}</div>
              <div className="tiles">
                {PAKKETTEN.filter((p) => p.spoor === sp).map((p) => (
                  <div key={p.id} className="tile" id={`pk-${p.id}`}>
                    {p.advies ? <span className="star">Standaardadvies</span> : null}
                    <div className="tn2">{p.naam}</div>
                    <div className="tp">{eur(TARIEF[p.id])}</div>
                    <div className="tu">{sp === "org" ? <>per maand · 3 mnd {eur(TARIEF[p.id] * 3)}</> : p.eenheid}</div>
                    <div className="tq">{sp === "org" ? `${p.n1} shorts per maand` : `${p.n1} basisvideo's · ${p.n2} varianten`}</div>
                  </div>
                ))}
              </div>
              <div className="facts">
                {d.feiten.map((f) => <div key={f.k}><span>{f.k}</span><b className={f.nooit ? "neg" : ""}>{f.open ? <span className="openchip">{f.v}</span> : f.v}</b></div>)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="eyebrow mt">Niet verwarren</div>
      <h2>Hier haal je ze snel door elkaar</h2>
      <p className="sub">Dezelfde vraag, een ander antwoord per pakket.</p>
      <div className="card vs">
        <table>
          <thead><tr><th className="q">Vraag</th><th className="o">Organisch</th><th className="a">Advertenties</th></tr></thead>
          <tbody>
            {VERWARRING.map((r, i) => (
              <tr key={r.vraag} id={`vs-${i}`}>
                <td className="q">{r.vraag}</td>
                {r.beide ? <td className="both" colSpan={2}><Rijk tekst={r.org} /></td> : <><td className="o"><Rijk tekst={r.org} /></td><td className="a"><Rijk tekst={r.ads ?? ""} /></td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="x" open>
        <summary><SpoorLabel spoor="ads" /> 3 hooks is niet 3 video&apos;s</summary>
        <div className="in"><div className="hooks">
          <span className="bx">1 basisvideo</span><span>→</span>
          <span className="stack"><span>Hook A</span><span>Hook B</span><span>Hook C</span></span><span>→</span>
          <span className="bx blue">3 varianten om te testen</span>
          <span className="muted">Alleen de opening verschilt. De rest van de video is gelijk. Ads 6 = 6 basisvideo&apos;s = 18 varianten.</span>
        </div></div>
      </details>

      <div className="eyebrow mt">Per soort pakket</div>
      <h2>Wat zit er wel en niet in?</h2>
      <p className="sub">Exact zoals in de prijslijst. Organisch 6 en 8 hebben dezelfde inhoud, alleen het aantal shorts verschilt. Dat geldt ook voor Ads 6 en 8.</p>
      <div className="incs">
        {(["org", "ads"] as Spoor[]).map((sp) => {
          const c = INHOUD[sp];
          return (
            <div key={sp} className={`inc ${sp}`}>
              <div className="ih"><b>{sp === "org" ? "Organisch 6 en 8" : "Ads 6 en 8"}</b><span>{SPLITSING[sp].doel}</span></div>
              <div className="cnt">
                {PAKKETTEN.filter((p) => p.spoor === sp).map((p) => <div key={p.id}><b>{sp === "org" ? `${p.n1} shorts` : `${p.n1} x 3 hooks`}</b><span>{p.naam} · {sp === "org" ? "per maand" : `${p.n2} varianten`}</span></div>)}
              </div>
              <div className="lists">
                <div><h4 className="g">✓ Inbegrepen</h4><ul>{c.ja.map((r, i) => <li key={r.t} id={`inc-${sp}-ja-${i}`}><i className="y1">✓</i><span>{r.t}{r.s ? <small>{r.s}</small> : null}</span></li>)}</ul></div>
                <div><h4 className="r">✕ Niet inbegrepen</h4><ul>{c.nee.map((r, i) => <li key={r.t} id={`inc-${sp}-nee-${i}`}><i className="n1">✕</i><span>{r.t}{r.s ? <small>{vul(r.s)}</small> : null}</span></li>)}</ul></div>
              </div>
              <div className="know">{c.weten.map((r, i) => <div key={r.k} id={`kv-${sp}-${i}`}><b>{r.k}</b><span>{vul(r.v)}</span></div>)}</div>
            </div>
          );
        })}
      </div>
      <NogOpen prefix="open" />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2 Stappen en prijzen                                                 */
/* ------------------------------------------------------------------ */

function Stappen() {
  return (
    <section>
      <div className="eyebrow">Van offerte tot rapport</div>
      <h2>Stappen en prijzen</h2>
      <p className="sub">Per stap: de termijn, wat inbegrepen is, wat extra kost en waar je op let. Geldt voor beide pakketten, tenzij <span className="mini org">ORG</span> of <span className="mini ads">ADS</span> erbij staat.</p>
      <div className="flow">
        {STAPPEN.map((st, i) => (
          <div className="st" id={`st-${i}`} key={st.titel}>
            <div className={`num ${st.opnamedag ? "day" : ""}`}>{i + 1}</div>
            <div className="ti"><b>{st.titel}</b><span className="when">{st.termijn}</span><span className="ref">{st.bron}</span></div>
            <div className="col in"><div className="ch"><i>✓</i>Inbegrepen</div>{st.inbegrepen.length ? <ul>{st.inbegrepen.map((x) => <li key={x}><MetLabel tekst={x} /></li>)}</ul> : <span className="none">-</span>}</div>
            <div className="col ex"><div className="ch"><i>€</i>Kost extra</div>{st.extra.length ? <ul>{st.extra.map((e) => <li key={e.wat}><span>{e.wat}{e.toelichting ? <small> · {e.toelichting}</small> : null}</span><Prijslabel tarief={e.tarief} element="chip" /></li>)}</ul> : <span className="none">Geen extra kosten</span>}</div>
            <div className="col lo"><div className="ch"><i>!</i>Let op</div>{st.letop.length ? <ul>{st.letop.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="none">-</span>}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3 Extra kosten                                                       */
/* ------------------------------------------------------------------ */

function ExtraKosten() {
  return (
    <section>
      <div className="eyebrow">Meerwerk</div>
      <h2>Extra kosten</h2>
      <p className="sub">Alle bedragen exclusief btw.</p>
      <div className="notice"><b>Meerwerk pas na akkoord per mail.</b> Staat het hier niet bij? Geen bedrag noemen, eerst navragen.</div>
      <div className="xc">
        {EXTRA_KOSTEN.map((c, ci) => (
          <div className="card xcat" key={c.categorie}>
            <div className="xh"><b>{c.categorie}</b><span className="step">Stap: {c.stap}</span></div>
            {c.regels.map((r, ri) => (
              <div className="xr" id={`ex-${ci}-${ri}`} key={r.wat}>
                <span className="w">{r.wat}<SpoorLabel spoor={r.spoor} /></span>
                <span className="d">{r.wanneer}</span>
                <span className="p"><Prijslabel tarief={r.tarief} /></span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4 Klantvragen                                                        */
/* ------------------------------------------------------------------ */

function Klantvragen() {
  return (
    <section>
      <div className="eyebrow">Antwoorden voor klanten</div>
      <h2>Zo handel je</h2>
      <p className="sub">Vier stappen bij elke vraag over extra kosten.</p>
      <div className="steps4">{KLANT_STAPPEN.map((t, i) => <div className="card s4" key={t}><div className="no">{i + 1}</div><b>{t}</b></div>)}</div>
      <div className="notice y"><b>Niet standaard?</b> Staat het niet in deze prijslijst? Geen bedrag noemen. Vandaag navragen en daarna terugkoppelen.</div>
      <h2>Veelgestelde vragen</h2>
      <p className="sub">Klik op een vraag voor de vervolgactie.</p>
      <div className="faqs">
        {KLANTVRAGEN.map((f, i) => (
          <details className="card faq" id={`faq-${i}`} key={f.vraag}>
            <summary>
              <div className="q"><span>&quot;{f.vraag}&quot;</span><SpoorLabel spoor={f.spoor} /></div>
              <div className="a">
                {f.tarief ? <><span className="pill">{eur(TARIEF[f.tarief])}</span><span>{f.eenheid}</span></> : <span className="pill txt">{f.tekst}</span>}
                {f.tarief2 ? <><span className="pill">{eur(TARIEF[f.tarief2])}</span><span>{f.eenheid2}</span></> : null}
              </div>
              <div className="more">Vervolgactie tonen</div>
            </summary>
            <div className="act">{f.actie}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 5 Interne afspraken                                                  */
/* ------------------------------------------------------------------ */

function Afspraken() {
  return (
    <section>
      <div className="eyebrow">Bevoegdheden</div>
      <h2>Wie beslist</h2>
      <p className="sub">Per onderwerp: wat je zelf mag en wanneer het eerst naar Jarno gaat.</p>
      <div className="card dtbl">
        <table>
          <thead><tr><th className="o">Onderwerp</th><th className="s">✓ Zelf beslissen</th><th className="j">→ Eerst naar Jarno</th></tr></thead>
          <tbody>{WIE_BESLIST.map((r, i) => <tr key={r[0]} id={`bs-${i}`}><td className="o">{r[0]}</td><td className="s">{vul(r[1])}</td><td className="j">{vul(r[2])}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="notice"><b>Naar Jarno?</b> Neem altijd je eigen voorstel mee.&nbsp; <b>Afwijkend tarief of afspraak?</b> Altijd eerst intern afstemmen, daarna pas per mail bevestigen richting de klant.</div>

      <div className="eyebrow mt">Uit je hoofd</div>
      <h2>De 7 kernafspraken</h2>
      <p className="sub">Label = artikel algemene voorwaarden. Alle termijnen per stap staan bij Stappen en prijzen.</p>
      <div className="kern">{KERNAFSPRAKEN.map((a, i) => <div className="kc" id={`kn-${i}`} key={a.k}><span className="ref">{a.ref}</span><div className="k">{a.k}</div><div className="v">{a.v}</div><div className="d">{a.d}</div></div>)}</div>

      <h2>Overige afspraken</h2>
      {OVERIGE_AFSPRAKEN.map((g, gi) => (
        <Fragment key={g.groep}>
          <div className="grpt">{g.groep}</div>
          <div className="acards">{g.items.map((a, ai) => <div className="card ac" id={`ov-${gi}-${ai}`} key={a.k}><span className="ref">{a.ref}</span><div className="k">{a.k}</div><div className="v">{a.v}</div><div className="d">{a.d}</div></div>)}</div>
        </Fragment>
      ))}
      <NogOpen prefix="open2" />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 6 Snelle prijsgids                                                   */
/* ------------------------------------------------------------------ */

function Gids() {
  const regel = (t: TariefKey | string): ReactNode => isTariefKey(t) ? <b>{eur(TARIEF[t])}</b> : <b className="mut">{t}</b>;
  return (
    <section>
      <div className="eyebrow">Tijdens het klantgesprek</div>
      <h2>Snelle prijsgids</h2>
      <p className="sub">Kies eerst het pakket, daarna het bedrag.</p>
      <div className="gl">
        {(["org", "ads"] as Spoor[]).map((sp) => (
          <div key={sp} className={`gcard ${sp}`}>
            <div className="gh"><b>{SPLITSING[sp].naam}</b><span className={`trk ${sp}`}>{sp === "org" ? "Per maand · wij publiceren" : "3 hooks per video · klant zet live"}</span></div>
            <div className="gprice">
              {PAKKETTEN.filter((p) => p.spoor === sp).map((p) => (
                <div key={p.id}>
                  <div className="l">{p.naam} · {p.n1} {p.l1.replace(" per maand", "")}</div>
                  <div className="p">{eur(TARIEF[p.id])}</div>
                  <div className="s">{sp === "org" ? `3 mnd: ${eur(TARIEF[p.id] * 3)}` : `${p.n2} varianten · basis nog open`}</div>
                </div>
              ))}
            </div>
            <div className="glines">{GIDS[sp].map((r) => <div key={r.wat}><span>{r.wat}</span>{regel(r.tarief)}</div>)}</div>
          </div>
        ))}
      </div>
      <div className="card both">
        <div className="bh"><b>Geldt voor beide pakketten</b><SpoorLabel spoor="beide" /></div>
        <div className="bcols">
          {GIDS_BEIDE.map((c) => (
            <div className="bcol" key={c.kop}><h4>{c.kop}</h4>{c.regels.map((r) => <div key={r.wat}><span>{r.wat}</span><Prijslabel tarief={r.tarief} /></div>)}</div>
          ))}
        </div>
      </div>
      <div className="inex">
        <div className="card"><div className="qh g">✓ Altijd inbegrepen</div><div className="tags">{ALTIJD.map((t) => <span className="tg yes" key={t}>{t}</span>)}</div></div>
        <div className="card"><div className="qh r">✕ Nooit inbegrepen</div><div className="tags">{NOOIT.map((t) => <span className="tg no" key={t}>{t}</span>)}</div></div>
      </div>
      <div className="gdec">
        <div className="s"><h4>Zelf beslissen</h4>Tot 5% korting · coulance tot {eur(TARIEF.coulance)} · 1 extra feedbackronde per kwartaal</div>
        <div className="j"><h4>Eerst naar Jarno</h4>Meer korting · gratis werk · extra draaidag · impact boven {eur(TARIEF.coulance)} · klant wil stoppen</div>
      </div>
    </section>
  );
}
