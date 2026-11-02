import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { mentorConversations, mentorMessages, mentorMemories } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { MENTOR_SYSTEM, buildMentorContext } from "@/server/mentor";

/* ------------------------------------------------------------------ *
 * Volledige export van de AI CEO Mentor naar één huisstijl-PDF.
 * Verzamelt ALLE opgebouwde inhoud (gesprekken + berichten + persoonlijk
 * geheugen) plus een snapshot van de bedrijfscontext op het exportmoment en
 * de persona, zodat er niets verloren gaat vóór een eventuele verwijdering.
 * ------------------------------------------------------------------ */

export type MentorExportData = {
  generatedAt: Date;
  ownerName: string;
  conversations: Array<{
    title: string;
    pinned: boolean;
    createdAt: Date | null;
    lastMessageAt: Date | null;
    messages: Array<{ role: string; content: string; at: Date | null }>;
  }>;
  memoriesByKind: Array<{ kind: string; label: string; items: Array<{ content: string; status: string | null; at: Date | null }> }>;
  totals: { conversations: number; messages: number; memories: number };
  contextSnapshot: string;
  persona: string;
};

const MEMORY_LABEL: Record<string, string> = {
  voorkeur: "Voorkeuren",
  feit: "Bedrijfsfeiten",
  beslissing: "Beslissingen",
  actie: "Openstaande acties",
  inzicht: "Inzichten",
};
const MEMORY_ORDER = ["voorkeur", "feit", "beslissing", "actie", "inzicht"];

/** Haalt alle mentor-inhoud van de eigenaar op (owner-only via de route). */
export async function getMentorExportData(viewer: Viewer): Promise<MentorExportData> {
  const convRows = await db
    .select({
      id: mentorConversations.id,
      title: mentorConversations.title,
      pinnedAt: mentorConversations.pinnedAt,
      createdAt: mentorConversations.createdAt,
      lastMessageAt: mentorConversations.lastMessageAt,
    })
    .from(mentorConversations)
    .where(and(eq(mentorConversations.userId, viewer.id), isNull(mentorConversations.deletedAt)))
    .orderBy(desc(mentorConversations.pinnedAt), desc(mentorConversations.lastMessageAt));

  const convIds = convRows.map((c) => c.id);
  const msgRows = convIds.length
    ? await db
        .select({
          conversationId: mentorMessages.conversationId,
          role: mentorMessages.role,
          content: mentorMessages.content,
          createdAt: mentorMessages.createdAt,
        })
        .from(mentorMessages)
        .where(inArray(mentorMessages.conversationId, convIds))
        .orderBy(asc(mentorMessages.createdAt))
    : [];

  const byConv = new Map<string, Array<{ role: string; content: string; at: Date | null }>>();
  for (const m of msgRows) {
    if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
    byConv.get(m.conversationId)!.push({ role: m.role, content: m.content, at: m.createdAt ?? null });
  }

  const conversations = convRows.map((c) => ({
    title: c.title,
    pinned: Boolean(c.pinnedAt),
    createdAt: c.createdAt ?? null,
    lastMessageAt: c.lastMessageAt ?? null,
    messages: byConv.get(c.id) ?? [],
  }));

  const memRows = await db
    .select({
      kind: mentorMemories.kind,
      content: mentorMemories.content,
      status: mentorMemories.status,
      createdAt: mentorMemories.createdAt,
    })
    .from(mentorMemories)
    .where(and(eq(mentorMemories.userId, viewer.id), isNull(mentorMemories.deletedAt)))
    .orderBy(asc(mentorMemories.createdAt));

  const memMap = new Map<string, Array<{ content: string; status: string | null; at: Date | null }>>();
  for (const m of memRows) {
    const k = m.kind || "inzicht";
    if (!memMap.has(k)) memMap.set(k, []);
    memMap.get(k)!.push({ content: m.content, status: m.status ?? null, at: m.createdAt ?? null });
  }
  const memoriesByKind = MEMORY_ORDER.filter((k) => memMap.has(k))
    .concat([...memMap.keys()].filter((k) => !MEMORY_ORDER.includes(k)))
    .map((k) => ({ kind: k, label: MEMORY_LABEL[k] ?? k, items: memMap.get(k)! }));

  const contextSnapshot = await buildMentorContext(viewer).catch(() => "");

  return {
    generatedAt: new Date(),
    ownerName: viewer.fullName,
    conversations,
    memoriesByKind,
    totals: {
      conversations: conversations.length,
      messages: msgRows.length,
      memories: memRows.length,
    },
    contextSnapshot,
    persona: MENTOR_SYSTEM,
  };
}

/* ----------------------------- Rendering ----------------------------- */

const NAVY = "#00003b";
const BLUE = "#2E90FA";
const ORANGE = "#FF6A00";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const dmy = (d: Date | null) =>
  d ? d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "onbekend";
const dmyTime = (d: Date | null) =>
  d ? d.toLocaleString("nl-NL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Lichte, veilige markdown → HTML voor de berichten: eerst escapen, daarna
 * koppen, opsommingen, genummerde lijsten, vet en cursief. Geen externe
 * afhankelijkheid, zodat de export dicht bij de originele opmaak blijft.
 */
function mdToHtml(raw: string): string {
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  const lines = esc(raw).replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const line of lines) {
    const t = line.trim();
    if (t === "") { closeList(); continue; }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h5 class="msg-h">${inline(h[2]!)}</h5>`); continue; }
    const ul = t.match(/^[-*]\s+(.*)$/);
    if (ul) { if (list !== "ul") { closeList(); out.push('<ul class="msg-list">'); list = "ul"; } out.push(`<li>${inline(ul[1]!)}</li>`); continue; }
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { if (list !== "ol") { closeList(); out.push('<ol class="msg-list">'); list = "ol"; } out.push(`<li>${inline(ol[1]!)}</li>`); continue; }
    closeList();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join("");
}

export function renderMentorExportHtml(data: MentorExportData): string {
  const gen = data.generatedAt.toLocaleString("nl-NL", { dateStyle: "full", timeStyle: "short" });

  const memoryChapter = data.memoriesByKind.length === 0
    ? `<p class="muted">Er is geen persoonlijk geheugen vastgelegd.</p>`
    : data.memoriesByKind.map((g) => `
        <div class="mem-group">
          <h4>${esc(g.label)} <span class="count">${g.items.length}</span></h4>
          <ul class="mem-list">
            ${g.items.map((it) => `
              <li>
                <span class="mem-content">${esc(it.content)}</span>
                ${it.status ? `<span class="pill ${it.status === "afgerond" ? "pill-done" : "pill-open"}">${esc(it.status)}</span>` : ""}
                ${it.at ? `<span class="mem-date">${esc(dmy(it.at))}</span>` : ""}
              </li>`).join("")}
          </ul>
        </div>`).join("");

  const convChapter = data.conversations.length === 0
    ? `<p class="muted">Er zijn geen gesprekken opgeslagen.</p>`
    : data.conversations.map((c, idx) => `
        <div class="conv">
          <div class="conv-head">
            <span class="conv-nr">${idx + 1}</span>
            <div>
              <div class="conv-title">${esc(c.title)}${c.pinned ? ` <span class="pin">vastgezet</span>` : ""}</div>
              <div class="conv-meta">${c.messages.length} bericht${c.messages.length === 1 ? "" : "en"}${c.lastMessageAt ? ` · laatste activiteit ${esc(dmy(c.lastMessageAt))}` : ""}</div>
            </div>
          </div>
          ${c.messages.length === 0
            ? `<p class="muted small">Geen berichten in dit gesprek.</p>`
            : c.messages.map((m) => {
                const mine = m.role !== "assistant";
                return `
                  <div class="msg ${mine ? "msg-user" : "msg-ai"}">
                    <div class="msg-label">${mine ? esc(data.ownerName.split(" ")[0] || "Jarno") : "AI Mentor"}${m.at ? ` <span class="msg-time">${esc(dmyTime(m.at))}</span>` : ""}</div>
                    <div class="msg-body">${mine ? `<p>${esc(m.content).replace(/\n/g, "<br>")}</p>` : mdToHtml(m.content)}</div>
                  </div>`;
              }).join("")}
        </div>`).join("");

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>AI Mentor — export</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: Inter, system-ui, Arial, sans-serif; color: #1c2230; background: #fff; font-size: 12px; line-height: 1.55; margin: 0; }
  h1 { font-size: 24px; color: ${NAVY}; margin: 0 0 2px; }
  h2.chapter { font-size: 17px; color: #fff; background: ${NAVY}; border-radius: 8px; padding: 9px 14px; margin: 0 0 14px; }
  h2.chapter .ch-nr { color: ${BLUE}; font-weight: 800; margin-right: 8px; }
  h4 { font-size: 13px; color: ${NAVY}; margin: 16px 0 7px; }
  h4 .count { color: #8a90a2; font-weight: 600; font-size: 11px; }
  .header { background: ${NAVY}; color: #fff; border-radius: 12px; padding: 22px 24px; margin-bottom: 18px; }
  .header h1 { color: #fff; }
  .header .sub { color: rgba(255,255,255,.72); font-size: 12px; margin-top: 6px; }
  .header .accent { height: 4px; width: 64px; background: ${ORANGE}; border-radius: 3px; margin: 14px 0 0; }
  .chapter-wrap { margin: 0 0 10px; }
  .chapter-wrap.break { break-before: page; }
  .toc { background: #f5f7fb; border: 1px solid #e6e8ee; border-radius: 10px; padding: 14px 18px; margin-bottom: 8px; }
  .toc ol { margin: 6px 0 0; padding-left: 20px; line-height: 1.9; }
  .toc .muted { font-size: 11px; }
  .stats { display: flex; gap: 10px; margin: 2px 0 14px; }
  .stat { flex: 1; background: #f5f7fb; border: 1px solid #e6e8ee; border-radius: 10px; padding: 12px 14px; }
  .stat .n { font-size: 22px; font-weight: 800; color: ${NAVY}; }
  .stat .l { font-size: 10.5px; color: #8a90a2; text-transform: uppercase; letter-spacing: .04em; }
  .muted { color: #8a90a2; } .small { font-size: 10.5px; }
  /* Geheugen */
  .mem-group { break-inside: avoid; }
  ul.mem-list { list-style: none; margin: 0; padding: 0; }
  ul.mem-list li { background: #fff; border: 1px solid #e6e8ee; border-left: 3px solid ${BLUE}; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; break-inside: avoid; }
  .mem-content { display: inline; }
  .mem-date { color: #aab0bf; font-size: 10px; margin-left: 6px; }
  .pill { display: inline-block; font-size: 9.5px; font-weight: 700; border-radius: 999px; padding: 1px 8px; margin-left: 6px; text-transform: uppercase; letter-spacing: .03em; }
  .pill-open { background: #fff1e6; color: #a35200; }
  .pill-done { background: #e8f6f0; color: #1d6b4c; }
  /* Gesprekken */
  .conv { background: #fff; border: 1px solid #e6e8ee; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; break-inside: avoid; }
  .conv-head { display: flex; align-items: flex-start; gap: 10px; border-bottom: 1px solid #eef0f4; padding-bottom: 8px; margin-bottom: 10px; }
  .conv-nr { flex: none; width: 24px; height: 24px; border-radius: 6px; background: ${NAVY}; color: #fff; font-weight: 800; font-size: 12px; display: flex; align-items: center; justify-content: center; }
  .conv-title { font-size: 13.5px; font-weight: 800; color: ${NAVY}; }
  .conv-meta { font-size: 10.5px; color: #8a90a2; margin-top: 2px; }
  .pin { font-size: 9.5px; font-weight: 700; color: ${ORANGE}; border: 1px solid ${ORANGE}; border-radius: 999px; padding: 0 6px; margin-left: 4px; vertical-align: middle; }
  .msg { margin: 0 0 10px; break-inside: avoid; }
  .msg-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
  .msg-time { color: #aab0bf; font-weight: 500; text-transform: none; letter-spacing: 0; margin-left: 6px; }
  .msg-user .msg-label { color: ${BLUE}; }
  .msg-ai .msg-label { color: ${NAVY}; }
  .msg-body { border-radius: 8px; padding: 9px 12px; }
  .msg-user .msg-body { background: #eef5ff; border: 1px solid #d9e8ff; }
  .msg-ai .msg-body { background: #fafbfd; border: 1px solid #e6e8ee; }
  .msg-body p { margin: 0 0 7px; } .msg-body p:last-child { margin-bottom: 0; }
  .msg-body h5.msg-h { font-size: 12px; color: ${NAVY}; margin: 10px 0 5px; }
  .msg-body ul.msg-list, .msg-body ol.msg-list { margin: 4px 0 8px; padding-left: 18px; }
  .msg-body li { margin: 2px 0; }
  /* Appendix */
  pre.snap { white-space: pre-wrap; background: #f5f7fb; border: 1px solid #e6e8ee; border-radius: 8px; padding: 12px 14px; font-family: Inter, system-ui, Arial, sans-serif; font-size: 11px; line-height: 1.5; }
  .foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #eef0f4; font-size: 10px; color: #aab0bf; }
</style></head><body>
  <div class="header">
    <h1>AI CEO Mentor — volledige export</h1>
    <div class="sub">Archief van alle vastgelegde gesprekken, adviezen, analyses en persoonlijk geheugen van ${esc(data.ownerName)}.<br>Gegenereerd op ${esc(gen)}.</div>
    <div class="accent"></div>
  </div>

  <div class="stats">
    <div class="stat"><div class="n">${data.totals.conversations}</div><div class="l">Gesprekken</div></div>
    <div class="stat"><div class="n">${data.totals.messages}</div><div class="l">Berichten</div></div>
    <div class="stat"><div class="n">${data.totals.memories}</div><div class="l">Geheugenpunten</div></div>
  </div>

  <div class="toc">
    <h4 style="margin-top:4px">Inhoud</h4>
    <ol>
      <li>Persoonlijk geheugen <span class="muted">(${data.totals.memories} punten)</span></li>
      <li>Gesprekken met de mentor <span class="muted">(${data.totals.conversations} gesprekken, ${data.totals.messages} berichten)</span></li>
      <li>Bedrijfssnapshot op het moment van export</li>
      <li>Hoe de mentor was ingericht (persona &amp; werkwijze)</li>
    </ol>
  </div>

  <div class="chapter-wrap break">
    <h2 class="chapter"><span class="ch-nr">1</span>Persoonlijk geheugen</h2>
    ${memoryChapter}
  </div>

  <div class="chapter-wrap break">
    <h2 class="chapter"><span class="ch-nr">2</span>Gesprekken met de mentor</h2>
    ${convChapter}
  </div>

  <div class="chapter-wrap break">
    <h2 class="chapter"><span class="ch-nr">3</span>Bedrijfssnapshot op het moment van export</h2>
    <p class="muted small">De live bedrijfscontext die de mentor als feitenbasis gebruikte, vastgelegd op ${esc(gen)}.</p>
    <pre class="snap">${esc(data.contextSnapshot) || '<span class="muted">Niet beschikbaar.</span>'}</pre>
  </div>

  <div class="chapter-wrap break">
    <h2 class="chapter"><span class="ch-nr">4</span>Hoe de mentor was ingericht</h2>
    <p class="muted small">De persona, denkprincipes en werkwijze waarmee de AI Mentor adviseerde.</p>
    <pre class="snap">${esc(data.persona)}</pre>
  </div>

  <div class="foot">ShortClips · AI CEO Mentor — volledige export · ${esc(gen)}</div>
</body></html>`;
}
