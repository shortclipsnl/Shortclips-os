import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { salesResearch } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import type { ResearchResult } from "@/server/actions/sales-research";
import { PrintBar } from "./print-bar";

export const metadata: Metadata = { title: "Presentatie" };
export const dynamic = "force-dynamic";

const NAVY = "#00003b";
const BLUE = "#2E90FA";
const ORANGE = "#FF6A00";

export default async function PresentatiePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("ai:read");

  const [row] = await db.select().from(salesResearch).where(and(eq(salesResearch.id, id), isNull(salesResearch.deletedAt))).limit(1);
  if (!row) notFound();

  const r = (row.result ?? {}) as ResearchResult;
  const uit = new Set(r.slidesUit ?? []);
  const on = (key: string) => !uit.has(key);
  const company = row.companyName;
  const goals = Array.isArray(row.goals) ? (row.goals as unknown[]).filter((g): g is string => typeof g === "string") : [];

  const pijnpunten = (r.pijnpunten ?? []).filter((p) => !p.uit).slice(0, 5);
  const ideeen = (r.videoIdeeen ?? []).filter((v) => !v.uit).slice(0, 3);

  // Teamfoto's voor de "Maak kennis"-slide (bestaande assets in public/team).
  const team = ["jarno", "milou", "jeska", "rutger", "max", "nynke"];

  return (
    <div className="deck">
      <PrintBar backHref={`/ai/bedrijfsonderzoek/${id}`} />
      <style>{css}</style>

      {/* 1 — Cover */}
      <section className="slide cover">
        <div className="brand"><span className="brand-dot" />Shortclips</div>
        <div className="cover-mid">
          <div className="eyebrow">Persoonlijke social media analyse &amp; contentstrategie</div>
          <h1>De contentkansen voor {company}</h1>
          {goals.length ? <p className="cover-goals">Focus: {goals.slice(0, 3).join(" · ")}</p> : null}
        </div>
        <div className="cover-foot">
          <span>Voorbereid door Shortclips{row.contactName ? ` · voor ${row.contactName}` : ""}</span>
          {row.meetingDate ? <span>{row.meetingDate}</span> : null}
        </div>
      </section>

      {/* 2 — Het bedrijf */}
      {on("bedrijf") && r.bedrijf ? (
        <Slide n="01" title="Het bedrijf in beeld">
          <div className="two">
            <div>
              <P k="Wat ze doen" v={r.bedrijf.watDoen} />
              <P k="Doelgroep" v={r.bedrijf.doelgroep} />
              <P k="Regio" v={r.bedrijf.regio} />
            </div>
            <div>
              <P k="Positionering" v={r.bedrijf.positionering} />
              {r.bedrijf.sterkePunten?.length ? (
                <>
                  <div className="label">Sterke punten</div>
                  <ul>{r.bedrijf.sterkePunten.slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}</ul>
                </>
              ) : null}
            </div>
          </div>
        </Slide>
      ) : null}

      {/* 3 — Huidige social media */}
      {on("prestaties") && r.social?.length ? (
        <Slide n="02" title="Huidige social media">
          <div className="stats">
            {r.social.map((s, i) => (
              <div key={i} className="stat">
                <div className="stat-top">{s.platform}</div>
                <div className="stat-big">{s.volgers || "—"}</div>
                <div className="stat-sub">{s.frequentie || (s.gevonden === false ? "niet gevonden" : "cijfers niet openbaar")}</div>
              </div>
            ))}
          </div>
          <p className="note">Cijfers die platforms niet openbaar maken, zijn niet opgenomen of handmatig aangevuld.</p>
        </Slide>
      ) : null}

      {/* 4 — Grootste kansen (met de Shortclips-aanbeveling als onderschrift) */}
      {on("kansen") && pijnpunten.length ? (
        <Slide n="03" title="Waar liggen de grootste kansen?">
          <div className="cards">
            {pijnpunten.slice(0, 4).map((p, i) => (
              <div key={i} className="pcard">
                <div className="pcard-title">{p.observatie}</div>
                {p.shortclipsAanpak ? <div className="hook">Shortclips: {p.shortclipsAanpak}</div> : p.waaromGemisteKans ? <div className="pcard-body">{p.waaromGemisteKans}</div> : null}
              </div>
            ))}
          </div>
          {r.kansenVoorShortclips?.aanbevolenOplossing ? <p className="note"><strong>Onze aanpak:</strong> {r.kansenVoorShortclips.aanbevolenOplossing}</p> : null}
        </Slide>
      ) : null}

      {/* 5 — Video-ideeën */}
      {on("ideeen") && ideeen.length ? (
        <Slide n="04" title="Zo zouden wij jullie content aanpakken">
          <div className="cards">
            {ideeen.map((v, i) => (
              <div key={i} className="pcard">
                <div className="pcard-title">{v.titel}</div>
                {v.hook ? <div className="hook">“{v.hook}”</div> : null}
                {v.uitleg ? <div className="pcard-body">{v.uitleg}</div> : null}
              </div>
            ))}
          </div>
        </Slide>
      ) : null}

      {/* Maak kennis met Shortclips */}
      {on("maakkennis") ? (
        <Slide n="05" title="Maak kennis met Shortclips">
          <p className="lead">Shortclips is jullie externe short video contentafdeling. Wij ontwikkelen structureel resultaatgerichte content en begeleiden het volledige traject — van strategie en concept tot productie, montage, publicatie en optimalisatie.</p>
          <div className="team">
            {team.map((t) => (
              <img key={t} src={`/team/${t}.png`} alt="" className="team-face" />
            ))}
          </div>
          <div className="pills">
            {["TikTok", "Instagram Reels", "YouTube Shorts", "Facebook Reels", "LinkedIn"].map((p) => <span key={p} className="pill">{p}</span>)}
          </div>
        </Slide>
      ) : null}

      {/* Zo werken wij samen */}
      {on("werkwijze") ? (
        <Slide n="06" title="Zo werken wij samen">
          <div className="flow">
            {[
              ["Strategie", "Bedrijf, doelgroep en doelen"],
              ["Formats", "Onderwerpen, hooks en scripts"],
              ["Productie", "Opnames met onze videograaf"],
              ["Montage", "Jullie controleren via het portaal"],
              ["Distributie", "Publicatie op de kanalen"],
              ["Optimalisatie", "Meten, leren, bijsturen"],
            ].map(([t, d], i) => (
              <div key={t} className="flow-step">
                <div className="flow-n">{i + 1}</div>
                <div className="flow-t">{t}</div>
                <div className="flow-d">{d}</div>
              </div>
            ))}
          </div>
          <p className="note">Jullie hoeven niet zelf continu onderwerpen, scripts, opnames en montages te organiseren — wij nemen het contentproces structureel uit handen.</p>
        </Slide>
      ) : null}

      {/* Jullie eerste 3 maanden */}
      {on("roadmap") ? (
        <Slide n="07" title="Jullie eerste drie maanden">
          <div className="cards3">
            <div className="rcard">
              <div className="rcard-m">Maand 1 — Fundament</div>
              <p>Strategie bepalen, eerste formats ontwikkelen en starten met structurele publicaties.</p>
              {ideeen[0]?.titel ? <span className="rcard-ex">Bijv. “{ideeen[0].titel}”</span> : null}
            </div>
            <div className="rcard">
              <div className="rcard-m">Maand 2 — Testen &amp; verbeteren</div>
              <p>Resultaten analyseren, nieuwe invalshoeken testen en succesvolle formats verder ontwikkelen.</p>
              {ideeen[1]?.titel ? <span className="rcard-ex">Bijv. “{ideeen[1].titel}”</span> : null}
            </div>
            <div className="rcard">
              <div className="rcard-m">Maand 3 — Optimaliseren &amp; opschalen</div>
              <p>De sterkste formats doorontwikkelen, resultaten evalueren en een vervolgstrategie bepalen.</p>
              {ideeen[2]?.titel ? <span className="rcard-ex">Bijv. “{ideeen[2].titel}”</span> : null}
            </div>
          </div>
          <p className="note">Een samenwerking duurt minimaal drie maanden — genoeg om formats te testen, resultaten te verzamelen en de aanpak te verbeteren.</p>
        </Slide>
      ) : null}

      {/* Waarom Shortclips */}
      {on("waarom") ? (
        <Slide n="08" title="Waarom Shortclips?">
          <div className="cards">
            {[
              ["Eén externe contentafdeling", "Strategie, productie, montage, publicatie en optimalisatie — volledig uit handen."],
              ["Gespecialiseerd team", "Scriptschrijvers, videograaf en editors die dagelijks short video maken."],
              ["Structureel, niet eenmalig", "Vaste trajecten waarin we testen, meten en de aanpak blijven verbeteren."],
              ["Eén strategie, meerdere kanalen", "Dezelfde content zichtbaar op TikTok, Reels, Shorts en meer."],
            ].map(([t, d]) => (
              <div key={t} className="pcard">
                <div className="pcard-title">{t}</div>
                <div className="pcard-body">{d}</div>
              </div>
            ))}
          </div>
        </Slide>
      ) : null}

      {/* De volgende stap */}
      {on("vervolg") ? (
        <section className="slide cover closing">
          <div className="brand"><span className="brand-dot" />Shortclips</div>
          <div className="cover-mid">
            <h1>Klaar om structureel zichtbaar te worden?</h1>
            <p className="cover-goals">Wij worden jullie externe contentafdeling.</p>
            {r.vervolgstappen ? <p className="muted closing-note">{r.vervolgstappen}</p> : null}
          </div>
          <div className="cover-foot"><span>Structurele trajecten vanaf drie maanden</span><span>Shortclips</span></div>
        </section>
      ) : null}
    </div>
  );
}

function Slide({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="slide">
      <div className="slide-head">
        <span className="slide-n">{n}</span>
        <h2>{title}</h2>
        <span className="slide-brand">Shortclips</span>
      </div>
      <div className="slide-body">{children}</div>
    </section>
  );
}

function P({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="p">
      <div className="label">{k}</div>
      <div className="p-v">{v}</div>
    </div>
  );
}

const css = `
.deck { background:#e9ebf0; min-height:100vh; padding:24px; font-family:Inter,'Segoe UI',Arial,sans-serif; color:${NAVY}; }
.no-print {}
.slide { width:100%; max-width:1100px; aspect-ratio:16/9; margin:0 auto 24px; background:#fff; border-radius:16px; box-shadow:0 8px 30px rgba(11,36,71,.12); padding:48px 56px; display:flex; flex-direction:column; overflow:hidden; }
.slide.cover { background:${NAVY}; color:#fff; justify-content:space-between; }
.cover .brand { font-size:22px; font-weight:800; letter-spacing:-.01em; }
.cover-mid .eyebrow { color:${BLUE}; font-weight:700; text-transform:uppercase; letter-spacing:.08em; font-size:14px; }
.cover-mid h1 { font-size:52px; line-height:1.05; margin:10px 0 6px; font-weight:800; }
.cover .muted { color:#c7d2e4; }
.cover-foot { color:#8ba0c0; font-size:13px; display:flex; justify-content:space-between; gap:12px; }
.brand { display:flex; align-items:center; gap:9px; }
.brand-dot { width:16px; height:16px; border-radius:5px; background:linear-gradient(135deg,#5BC5FF,#1B5FE0); display:inline-block; }
.cover-goals { color:${BLUE}; font-weight:700; margin-top:10px; font-size:17px; }
.closing-note { font-size:15px; max-width:60ch; margin-top:14px; }
.team { display:flex; gap:12px; margin-top:22px; }
.team-face { width:64px; height:64px; border-radius:50%; object-fit:cover; border:2px solid #eef1f6; }
.pills { display:flex; flex-wrap:wrap; gap:8px; margin-top:20px; }
.pill { background:#f4f6fa; color:${NAVY}; border-radius:999px; padding:6px 14px; font-size:13px; font-weight:600; }
.flow { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; }
.flow-step { background:#f4f6fa; border-radius:12px; padding:14px 12px; border-top:3px solid ${BLUE}; }
.flow-n { width:26px; height:26px; border-radius:50%; background:${NAVY}; color:#fff; font-weight:800; font-size:13px; display:grid; place-items:center; margin-bottom:8px; }
.flow-t { font-weight:800; font-size:15px; }
.flow-d { font-size:12px; color:#53617a; margin-top:3px; line-height:1.35; }
.cards3 { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
.rcard { background:#f4f6fa; border-radius:12px; padding:18px; border-top:4px solid ${ORANGE}; }
.rcard-m { font-weight:800; font-size:16px; margin-bottom:8px; }
.rcard p { font-size:14px; color:#53617a; line-height:1.45; margin:0; }
.rcard-ex { display:block; margin-top:10px; color:${BLUE}; font-weight:600; font-size:13px; }
.slide-head { display:flex; align-items:center; gap:14px; border-bottom:2px solid #eef1f6; padding-bottom:14px; }
.slide-n { color:${ORANGE}; font-weight:800; font-size:18px; }
.slide-head h2 { font-size:28px; font-weight:800; margin:0; flex:1; }
.slide-brand { color:#9fb0c9; font-weight:700; font-size:13px; }
.slide-body { padding-top:22px; flex:1; min-height:0; }
.two { display:grid; grid-template-columns:1fr 1fr; gap:32px; }
.label { text-transform:uppercase; letter-spacing:.06em; font-size:12px; font-weight:700; color:#8295b0; margin:12px 0 4px; }
.p-v { font-size:17px; line-height:1.4; }
.p { margin-bottom:10px; }
ul { margin:4px 0 0; padding-left:20px; } li { font-size:17px; line-height:1.5; margin-bottom:4px; }
.big-list li { font-size:20px; margin-bottom:12px; }
.stats { display:flex; gap:18px; flex-wrap:wrap; }
.stat { flex:1; min-width:150px; background:#f4f6fa; border-radius:12px; padding:18px; }
.stat-top { font-weight:700; color:${BLUE}; }
.stat-big { font-size:32px; font-weight:800; margin:6px 0 2px; }
.stat-sub { font-size:13px; color:#7b8aa3; }
.note { margin-top:16px; font-size:13px; color:#8295b0; }
.cards { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.pcard { background:#f4f6fa; border-left:4px solid ${ORANGE}; border-radius:10px; padding:16px 18px; }
.pcard-title { font-weight:700; font-size:17px; }
.pcard-body { font-size:14px; color:#53617a; margin-top:6px; line-height:1.45; }
.hook { color:${BLUE}; font-weight:600; font-size:14px; margin-top:4px; }
.accent { color:${ORANGE}; font-size:30px; font-weight:800; margin:0 0 12px; }
.lead { font-size:20px; line-height:1.5; max-width:46ch; }
.cta { margin-top:26px; color:${BLUE}; font-weight:700; }
@media print {
  @page { size: A4 landscape; margin:0; }
  body { background:#fff; }
  .deck { background:#fff; padding:0; }
  .no-print { display:none !important; }
  .slide { box-shadow:none; border-radius:0; margin:0; max-width:none; width:100%; height:100vh; aspect-ratio:auto; page-break-after:always; }
}
`;
