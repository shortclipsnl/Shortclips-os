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

  const pijnpunten = (r.pijnpunten ?? []).filter((p) => !p.uit).slice(0, 5);
  const ideeen = (r.videoIdeeen ?? []).filter((v) => !v.uit).slice(0, 5);

  return (
    <div className="deck">
      <PrintBar backHref={`/ai/bedrijfsonderzoek/${id}`} />
      <style>{css}</style>

      {/* 1 — Cover */}
      <section className="slide cover">
        <div className="brand">Shortclips</div>
        <div className="cover-mid">
          <div className="eyebrow">Social Media &amp; Video Analyse</div>
          <h1>{company}</h1>
          {r.periodeOnderzocht ? <p className="muted">{r.periodeOnderzocht}</p> : null}
        </div>
        <div className="cover-foot">Voorbereid door Shortclips</div>
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

      {/* 4 — Wat gaat goed */}
      {on("gaatgoed") && r.gaatGoed?.length ? (
        <Slide n="03" title="Wat gaat er al goed?">
          <ul className="big-list">{r.gaatGoed.slice(0, 5).map((g, i) => <li key={i}>{g}</li>)}</ul>
        </Slide>
      ) : null}

      {/* 5 — Grootste kansen */}
      {on("kansen") && pijnpunten.length ? (
        <Slide n="04" title="Waar liggen de grootste kansen?">
          <div className="cards">
            {pijnpunten.map((p, i) => (
              <div key={i} className="pcard">
                <div className="pcard-title">{p.observatie}</div>
                {p.waaromGemisteKans ? <div className="pcard-body">{p.waaromGemisteKans}</div> : null}
              </div>
            ))}
          </div>
        </Slide>
      ) : null}

      {/* 6 — Wat betekent dit */}
      {on("betekenis") && pijnpunten.some((p) => p.impact) ? (
        <Slide n="05" title="Wat betekent dit voor het bedrijf?">
          <ul className="big-list">
            {pijnpunten.filter((p) => p.impact).slice(0, 4).map((p, i) => <li key={i}>{p.impact}</li>)}
          </ul>
        </Slide>
      ) : null}

      {/* 7 — Hoe Shortclips helpt */}
      {on("shortclips") && r.kansenVoorShortclips ? (
        <Slide n="06" title="Hoe Shortclips kan helpen">
          <h2 className="accent">{r.kansenVoorShortclips.aanbevolenOplossing}</h2>
          {r.kansenVoorShortclips.toelichting ? <p className="lead">{r.kansenVoorShortclips.toelichting}</p> : null}
        </Slide>
      ) : null}

      {/* 8 — Video-ideeën */}
      {on("ideeen") && ideeen.length ? (
        <Slide n="07" title="Concrete video-ideeën">
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

      {/* 9 — Contentaanpak */}
      {on("aanpak") && (ideeen.length || r.kansenVoorShortclips) ? (
        <Slide n="08" title="Voorgestelde contentaanpak">
          <p className="lead">Een eerste samenwerking waarin Shortclips als externe videoafdeling structureel content ontwikkelt, produceert en begeleidt — afgestemd op {company}.</p>
          {ideeen.length ? (
            <>
              <div className="label">Mogelijke contentpijlers</div>
              <ul>{ideeen.map((v, i) => <li key={i}>{v.titel}</li>)}</ul>
            </>
          ) : null}
        </Slide>
      ) : null}

      {/* 10 — Vervolgstappen */}
      {on("vervolg") ? (
        <Slide n="09" title="Vervolgstappen">
          <p className="lead">{r.vervolgstappen || "Laten we samen de beste aanpak bepalen en de eerste contentconcepten verder uitwerken."}</p>
          <div className="cta">Shortclips · korte videocontent die presteert</div>
        </Slide>
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
.cover-foot { color:#8ba0c0; font-size:13px; }
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
