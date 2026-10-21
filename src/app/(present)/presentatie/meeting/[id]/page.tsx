import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { meetingItems, teamMeetings } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { formatDate } from "@/lib/format";
import { PrintBar } from "../../[id]/print-bar";

export const metadata: Metadata = { title: "Bespreekpunten" };
export const dynamic = "force-dynamic";

const NAVY = "#00003b";
const BLUE = "#2E90FA";
const ORANGE = "#FF6A00";

/**
 * Presentatie van de bespreekpunten van een teammeeting: één punt per pagina,
 * in de ShortClips-huisstijl. Bedoeld om op groot scherm door te nemen of als
 * PDF op te slaan (Print / PDF-knop rechtsboven).
 */
export default async function MeetingPresentationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;

  const [meeting] = await db.select().from(teamMeetings).where(eq(teamMeetings.id, id)).limit(1);
  if (!meeting) notFound();

  const items = await db
    .select()
    .from(meetingItems)
    .where(eq(meetingItems.meetingId, id))
    .orderBy(asc(meetingItems.createdAt));
  const punten = items.filter((i) => i.kind === "agenda");

  const when = new Date(meeting.scheduledAt);
  const dateStr = `${formatDate(when)} · ${new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }).format(when)}`;

  return (
    <div className="deck">
      <PrintBar backHref={`/meetings/${id}`} />
      <style>{css}</style>

      {/* Cover */}
      <section className="slide cover">
        <div className="brand">Shortclips</div>
        <div className="cover-mid">
          <div className="eyebrow">Teammeeting · Bespreekpunten</div>
          <h1>{meeting.title}</h1>
          <p className="muted">{dateStr}{meeting.location ? ` · ${meeting.location}` : ""}</p>
        </div>
        <div className="cover-foot">{punten.length} {punten.length === 1 ? "bespreekpunt" : "bespreekpunten"}</div>
      </section>

      {/* Eén punt per pagina */}
      {punten.length === 0 ? (
        <section className="slide point">
          <div className="point-body">
            <h2 className="point-text muted-text">Nog geen bespreekpunten genoteerd voor deze meeting.</h2>
          </div>
        </section>
      ) : (
        punten.map((p, i) => (
          <section key={p.id} className="slide point">
            <div className="point-head">
              <span className="point-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="point-brand">Shortclips · {meeting.title}</span>
            </div>
            <div className="point-body">
              <h2 className="point-text">{p.body}</h2>
            </div>
            <div className="point-foot">
              <span>Bespreekpunt {i + 1} van {punten.length}</span>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

const css = `
.deck { background:#e9ebf0; min-height:100vh; padding:24px; font-family:Inter,'Segoe UI',Arial,sans-serif; color:${NAVY}; }
.slide { width:100%; max-width:1100px; aspect-ratio:16/9; margin:0 auto 24px; background:#fff; border-radius:16px; box-shadow:0 8px 30px rgba(11,36,71,.12); padding:48px 56px; display:flex; flex-direction:column; overflow:hidden; }
.slide.cover { background:${NAVY}; color:#fff; justify-content:space-between; }
.cover .brand { font-size:22px; font-weight:800; letter-spacing:-.01em; }
.cover-mid .eyebrow { color:${BLUE}; font-weight:700; text-transform:uppercase; letter-spacing:.08em; font-size:14px; }
.cover-mid h1 { font-size:52px; line-height:1.05; margin:10px 0 6px; font-weight:800; }
.cover .muted { color:#c7d2e4; }
.cover-foot { color:#8ba0c0; font-size:13px; }
.point { justify-content:space-between; }
.point-head { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #eef1f6; padding-bottom:16px; }
.point-n { color:${ORANGE}; font-weight:800; font-size:40px; line-height:1; }
.point-brand { color:#9fb0c9; font-weight:700; font-size:13px; }
.point-body { flex:1; display:flex; align-items:center; }
.point-text { font-size:40px; line-height:1.25; font-weight:800; margin:0; letter-spacing:-.01em; }
.point-text.muted-text { color:#8295b0; font-weight:600; font-size:28px; }
.point-foot { color:#9fb0c9; font-weight:600; font-size:13px; border-top:2px solid #eef1f6; padding-top:14px; }
@media print {
  @page { size: A4 landscape; margin:0; }
  body { background:#fff; }
  .deck { background:#fff; padding:0; }
  .no-print { display:none !important; }
  .slide { box-shadow:none; border-radius:0; margin:0; max-width:none; width:100%; height:100vh; aspect-ratio:auto; page-break-after:always; }
  .slide:last-child { page-break-after:auto; }
}
`;
