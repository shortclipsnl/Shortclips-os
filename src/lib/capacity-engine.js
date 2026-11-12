/* Gedeelde, pure rekenmotor (geen DB, geen DOM). Gebruikt door de
 * Capaciteitspagina (client) en de Vandaag-kaart (server). */
const E = {};
E.TODAY = new Date().toISOString().slice(0, 10);

  /* ---------- datums ---------- */
  let HOLIDAYS = new Set();
  E.setHolidays = (list) => { HOLIDAYS = new Set(list || []); };
  /** Stelt "vandaag" en de feestdagen in vóór een berekening. */
  E.configure = ({ today, holidays }) => { if (today) E.TODAY = today; E.setHolidays(holidays); };
  const toD = (s) => new Date(s + "T12:00:00Z");
  const toS = (d) => d.toISOString().slice(0, 10);
  E.addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); };
  E.dow = (s) => { const x = toD(s).getUTCDay(); return x === 0 ? 7 : x; }; // 1=ma..7=zo
  E.isWorkday = (s) => E.dow(s) <= 5 && !HOLIDAYS.has(s);
  E.nextWorkday = (s) => { let x = s; while (!E.isWorkday(x)) x = E.addDays(x, 1); return x; };
  E.addWorkdays = (s, n) => { let x = s, k = 0; while (k < n) { x = E.addDays(x, 1); if (E.isWorkday(x)) k++; } return x; };
  E.mondayOf = (s) => E.addDays(s, 1 - E.dow(s));
  E.isoWeek = (s) => {
    const d = toD(s); const day = E.dow(s); d.setUTCDate(d.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12));
    return Math.ceil(((d - y0) / 86400000 + 1) / 7);
  };
  const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const DAYS = ["", "ma", "di", "wo", "do", "vr", "za", "zo"];
  E.fmtDay = (s) => { const d = toD(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  E.fmtDayLong = (s) => `${DAYS[E.dow(s)]} ${E.fmtDay(s)}`;
  E.monthName = (m) => ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"][m];

  E.weeks = (count) => {
    const out = []; let m = E.mondayOf(E.TODAY);
    for (let i = 0; i < count; i++) {
      const days = [0, 1, 2, 3, 4].map((k) => E.addDays(m, k));
      out.push({ monday: m, friday: days[4], num: E.isoWeek(m), days, label: `Week ${E.isoWeek(m)}`, range: `${E.fmtDay(m)} t/m ${E.fmtDay(days[4])}` });
      m = E.addDays(m, 7);
    }
    return out;
  };

  /* ---------- periodes: deze week, volgende week, rest van de maand, 3 maanden ---------- */
  const lastOfMonth = (s) => E.addDays(E.addDays(s.slice(0, 7) + "-01", 32).slice(0, 7) + "-01", -1);
  E.periods = (months = 3) => {
    const m0 = E.mondayOf(E.TODAY);
    const mk = (label, sub, start, end, kind) => {
      const days = []; for (let x = start; x <= end; x = E.addDays(x, 1)) if (E.dow(x) <= 5) days.push(x);
      return { label, sub, monday: start, friday: end, days, kind, range: `${E.fmtDay(start)} t/m ${E.fmtDay(end)}`, num: null };
    };
    const out = [
      mk("Deze week", `week ${E.isoWeek(m0)}`, m0, E.addDays(m0, 4), "week"),
      mk("Volgende week", `week ${E.isoWeek(E.addDays(m0, 7))}`, E.addDays(m0, 7), E.addDays(m0, 11), "week"),
    ];
    const restStart = E.addDays(m0, 14); const end0 = lastOfMonth(E.TODAY);
    if (restStart <= end0) out.push(mk(`Rest ${E.monthName(Number(E.TODAY.slice(5, 7)) - 1)}`, `${E.fmtDay(restStart)} t/m ${E.fmtDay(end0)}`, restStart, end0, "rest"));
    let ms = E.addDays(end0, 1);
    for (let k = 0; k < months; k++) {
      const me = lastOfMonth(ms); const start = ms < restStart ? restStart : ms;
      const nm = E.monthName(Number(ms.slice(5, 7)) - 1);
      out.push(mk(nm.charAt(0).toUpperCase() + nm.slice(1), ms.slice(0, 4) !== E.TODAY.slice(0, 4) ? ms.slice(0, 4) : `${E.fmtDay(start)} t/m ${E.fmtDay(me)}`, start, me, "maand"));
      ms = E.addDays(me, 1);
    }
    return out;
  };
  E.weeksUntil = (end) => Math.ceil((toD(end) - toD(E.mondayOf(E.TODAY))) / 86400000 / 7) + 1;

  /* ---------- standaardinstellingen ---------- */
  E.defaultSettings = () => ({
    greenBelow: 80,       // groen tot (exclusief) 80%
    orangeMax: 100,       // oranje t/m 100%, daarboven rood
    setupHours: 0.5,      // opbouw/afbouw per opname
    handoverDays: 1,      // beelden bij editor: opnamedag + 1 werkdag
    editorDays: 7,        // eerste versie editor: opnamedag + 7 werkdagen
    clientDays: 14,       // oplevering klant: binnen 14 werkdagen
    feedbackHours: 72,    // feedbacktermijn klant
    includeExpected: true,// verwacht werk uit pakketten meetellen
    w: { beschikbaar: 1, bezig: 0.5, review: 0.1, bijKlant: 0.25, feedback: 0.25 },
  });

  /* ---------- capaciteit per persoon per week ---------- */
  const inLeave = (p, s) => (p.leave || []).some(([a, b]) => s >= a && s <= b);
  E.availableDays = (p, wk) => {
    // null = beschikbaarheid onbekend (voor de hele periode)
    const res = []; let known = false;
    for (const s of wk.days) {
      const pattern = p.pattern || (p.perWeek ? p.perWeek[E.mondayOf(s)] : null);
      if (!pattern) continue;
      known = true;
      if (pattern.includes(E.dow(s)) && E.isWorkday(s) && !inLeave(p, s)) res.push(s);
    }
    return known ? res : null;
  };
  E.capacity = (p, wk) => {
    const days = E.availableDays(p, wk);
    if (days === null) return null;
    if (p.role === "videograaf") return { value: days.length * p.hoursPerDay, days, unit: "uur" };
    if (p.shortsPerWeek == null) return null;
    const rem = days.filter((s) => s >= E.TODAY); // deze week: alleen resterende werkdagen
    return { value: Math.round(p.shortsPerWeek * (rem.length / 5) * 10) / 10, days: rem, unit: "video's" };
  };

  /* ---------- werk uitsmeren over werkdagen ---------- */
  function spread(total, start, end) {
    const out = {};
    if (total <= 0) return { out, overdue: false };
    let s = E.nextWorkday(start < E.TODAY ? E.TODAY : start);
    if (end < s) {
      // Over de deadline: het resterende werk over de eerstvolgende 3 werkdagen
      // verdelen in plaats van alles op vandaag te zetten.
      const d3 = [s, E.addWorkdays(s, 1), E.addWorkdays(s, 2)];
      d3.forEach((d) => { out[d] = (out[d] || 0) + total / 3; });
      return { out, overdue: end < E.TODAY };
    }
    const days = []; for (let x = s; x <= end; x = E.addDays(x, 1)) if (E.isWorkday(x)) days.push(x);
    if (!days.length) days.push(s);
    days.forEach((d) => { out[d] = (out[d] || 0) + total / days.length; });
    return { out, overdue: false };
  }
  const merge = (a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; };

  /* ---------- items opbouwen (zonder dubbeltellingen) ---------- */
  E.buildItems = (data, st, extraShoots) => {
    const set = st.settings; const w = set.w;
    const client = (id) => data.clients.find((c) => c.id === id) || { name: id, editor: null, quota: 0 };
    const vgItems = []; const edItems = [];
    const shotIds = new Set(data.projects.map((p) => p.shootRef).filter(Boolean));

    // 1. Bevestigde editingprojecten: elke video telt één keer, op zijn huidige status.
    for (const p of data.projects) {
      const editor = st.moves[p.id] !== undefined ? st.moves[p.id] : p.editor;
      const c = p.c; const daily = {}; let overdue = false;
      const main = (c.beschikbaar || 0) * w.beschikbaar + (c.bezig || 0) * w.bezig;
      const a = spread(main, E.TODAY, p.editorDue); merge(daily, a.out); overdue = overdue || (a.overdue && main > 0);
      merge(daily, spread((c.review || 0) * w.review, E.TODAY, E.addWorkdays(E.TODAY, 2)).out);
      merge(daily, spread((c.feedback || 0) * w.feedback, E.TODAY, E.addWorkdays(E.TODAY, 2)).out);
      merge(daily, spread((c.bijKlant || 0) * w.bijKlant, E.addWorkdays(E.TODAY, 3), E.addWorkdays(E.TODAY, 5)).out);
      const open = (c.beschikbaar || 0) + (c.bezig || 0) + (c.review || 0) + (c.feedback || 0);
      edItems.push({ id: p.id, source: "bevestigd", client: p.client, clientName: client(p.client).name, editor, origEditor: p.editor,
        date: p.shootDate, videos: Object.values(c).reduce((x, y) => x + y, 0), open, counts: c, daily, editorDue: p.editorDue, clientDue: p.clientDue, overdue });
    }

    // 2. Opnames. Toekomstige opnames geven voorspeld editingwerk, tot er een echt project is.
    const allShoots = data.shoots.map((s) => ({ ...s, source: s.source || "bevestigd" })).concat(extraShoots || []);
    // 3. Pakketverwachting: klant-maand zonder geplande opname (vanaf volgende maand).
    if (set.includeExpected && st.horizonEnd) {
      const curMonth = E.TODAY.slice(0, 7);
      const months = [];
      for (let m = E.addDays(E.TODAY.slice(0, 7) + "-01", 32).slice(0, 7); m + "-01" <= st.horizonEnd; m = E.addDays(m + "-01", 32).slice(0, 7)) months.push(m);
      for (const cl of data.clients.filter((c) => c.quota > 0)) for (const m of months) {
        if (m === curMonth) continue;
        const has = allShoots.some((s) => s.client === cl.id && s.date.slice(0, 7) === m);
        if (has) continue;
        // zelfde ritme als de laatste opname van de klant (anders halverwege de maand)
        const last = allShoots.filter((s) => s.client === cl.id && s.source !== "verwacht" && s.date < m).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        const lastDate = last ? last.date : cl.lastDate || null;
        const dom = lastDate ? Math.min(28, Number(lastDate.slice(8, 10))) : 15;
        const date = E.nextWorkday(`${m}-${String(dom).padStart(2, "0")}`);
        allShoots.push({ id: `exp-${cl.id}-${m}`, date, client: cl.id, dur: last ? last.dur : cl.lastDur || 3, travel: last ? last.travel : (cl.lastTravel ?? set.defaultTravel ?? 1), vg: last ? last.vg : cl.lastVg || null, shorts: cl.quota, source: "verwacht" });
      }
    }

    for (const s of allShoots) {
      const vg = st.vgMoves[s.id] !== undefined ? st.vgMoves[s.id] : s.vg;
      const hours = s.dur + s.travel + set.setupHours;
      vgItems.push({ id: s.id, source: s.source, client: s.client, clientName: s.clientName || client(s.client).name, date: s.date, start: s.start, dur: s.dur, travel: s.travel, hours, vg, origVg: s.vg, shorts: s.shorts, simId: s.simId });
      if (s.date < E.TODAY) continue;            // al geschoten: zit (straks) in projecten
      if (shotIds.has(s.id)) continue;            // echt project bestaat al: geen voorspelling
      const baseEditor = s.editor !== undefined && s.editor !== null ? s.editor : client(s.client).editor;
      const editor = st.moves[s.id] !== undefined ? st.moves[s.id] : baseEditor;
      const daily = {};
      merge(daily, spread(s.shorts * w.beschikbaar, E.addWorkdays(s.date, set.handoverDays), E.addWorkdays(s.date, set.editorDays)).out);
      const fbStart = E.addWorkdays(s.date, set.editorDays + Math.ceil(set.feedbackHours / 24));
      merge(daily, spread(s.shorts * w.feedback, fbStart, E.addWorkdays(fbStart, 2)).out);
      edItems.push({ id: s.id, source: s.source === "bevestigd" ? "voorspeld" : s.source, client: s.client, clientName: s.clientName || client(s.client).name,
        editor, origEditor: baseEditor, viaDefault: s.editor == null, date: s.date, videos: s.shorts, open: s.shorts, daily,
        handover: E.addWorkdays(s.date, set.handoverDays), editorDue: E.addWorkdays(s.date, set.editorDays), clientDue: E.addWorkdays(s.date, set.clientDays), simId: s.simId });
    }
    return { vgItems, edItems };
  };

  /* ---------- status ---------- */
  E.status = (load, cap, set) => {
    if (cap === null) return { key: "grijs", pct: null };
    if (cap.value <= 0) return load > 0.05 ? { key: "rood", pct: null } : { key: "vrij", pct: null };
    const pct = Math.round((load / cap.value) * 100);
    if (pct < set.greenBelow) return { key: "groen", pct };
    if (pct <= set.orangeMax) return { key: "oranje", pct };
    return { key: "rood", pct };
  };

  /* ---------- hoofdberekening ---------- */
  E.compute = (data, st, weekCount, extraShoots) => {
    const set = st.settings;
    const weeks = Array.isArray(weekCount) ? weekCount : E.weeks(weekCount);
    const stx = { ...st, horizonEnd: weeks[weeks.length - 1].friday };
    const { vgItems, edItems } = E.buildItems(data, stx, extraShoots);
    const vgs = data.people.filter((p) => p.role === "videograaf");
    const eds = data.people.filter((p) => p.role === "editor");

    const vgRows = vgs.map((p) => ({
      person: p,
      cells: weeks.map((wk) => {
        const items = vgItems.filter((i) => i.vg === p.id && i.date >= wk.monday && i.date <= wk.friday);
        const load = items.reduce((a, i) => a + i.hours, 0);
        const cap = E.capacity(p, wk);
        const conflicts = [];
        const byDay = {};
        items.forEach((i) => { (byDay[i.date] = byDay[i.date] || []).push(i); });
        for (const d in byDay) {
          const h = byDay[d].reduce((a, i) => a + i.hours, 0);
          if (byDay[d].length > p.maxShootsPerDay) conflicts.push(`${E.fmtDayLong(d)}: ${byDay[d].length} opnames, maximum is ${p.maxShootsPerDay}`);
          else if (h > (p.dayMax || 8)) conflicts.push(`${E.fmtDayLong(d)}: ${fmtN(h)} uur werk op één dag (opnames + reistijd), werkdag is ${p.dayMax || 8} uur`);
          const avail = cap ? cap.days.includes(d) : true;
          if (cap && !avail) conflicts.push(`${E.fmtDayLong(d)}: ingepland op een dag dat ${p.name} niet beschikbaar is`);
        }
        if (cap === null && items.length) conflicts.push(`Opdracht ingepland, maar beschikbaarheid voor deze week is niet vastgelegd`);
        return { wk, items, load, cap, conflicts, ...E.status(load, cap, set), count: items.length };
      }),
    }));

    const edRows = eds.map((p) => ({
      person: p,
      cells: weeks.map((wk) => {
        const parts = []; let load = 0;
        for (const it of edItems) {
          if (it.editor !== p.id) continue;
          let s = 0; for (const d of wk.days) s += it.daily[d] || 0;
          if (s > 0.01) { parts.push({ item: it, amount: s }); load += s; }
        }
        const cap = E.capacity(p, wk);
        const conflicts = [];
        parts.forEach(({ item }) => {
          if (item.overdue) conflicts.push(`${item.clientName}: editordeadline ${E.fmtDay(item.editorDue)} is verstreken`);
          else if (item.editorDue >= wk.monday && item.editorDue <= wk.friday && load > (cap ? cap.value : Infinity))
            conflicts.push(`${item.clientName}: deadline ${E.fmtDayLong(item.editorDue)} komt in gevaar`);
        });
        if (cap === null && parts.length) conflicts.push(`Werk toegewezen, maar capaciteit van ${p.name} is niet vastgelegd`);
        return { wk, parts, load: Math.round(load * 10) / 10, cap, conflicts, ...E.status(load, cap, set) };
      }),
    }));

    // Niet toegewezen
    const vgOpen = weeks.map((wk) => {
      const items = vgItems.filter((i) => !i.vg && i.source !== "verwacht" && i.date >= wk.monday && i.date <= wk.friday);
      return { wk, items, count: items.length, hours: items.reduce((a, i) => a + i.hours, 0) };
    });
    const vgExpected = weeks.map((wk) => {
      const items = vgItems.filter((i) => i.source === "verwacht" && i.date >= wk.monday && i.date <= wk.friday);
      return { wk, items, count: items.length, hours: items.reduce((a, i) => a + i.hours, 0) };
    });
    const edOpen = weeks.map((wk) => {
      const parts = []; let load = 0;
      for (const it of edItems) {
        if (it.editor) continue;
        let s = 0; for (const d of wk.days) s += it.daily[d] || 0;
        if (s > 0.01) { parts.push({ item: it, amount: s }); load += s; }
      }
      return { wk, parts, load: Math.round(load * 10) / 10 };
    });

    // Team-totalen editing
    const edTeam = weeks.map((wk, i) => {
      let load = edOpen[i].load, cap = 0, known = 0;
      edRows.forEach((r) => { const c = r.cells[i]; load += c.load; if (c.cap) { cap += c.cap.value; known++; } });
      return { wk, load: Math.round(load * 10) / 10, cap: Math.round(cap * 10) / 10, ...E.status(load, known ? { value: cap } : null, set) };
    });
    const vgTeam = weeks.map((wk, i) => {
      let load = vgOpen[i].hours, cap = 0;
      vgRows.forEach((r) => { const c = r.cells[i]; load += c.load; if (c.cap) cap += c.cap.value; });
      return { wk, load, cap, ...E.status(load, { value: cap }, set) };
    });

    return { weeks, vgRows, edRows, vgOpen, vgExpected, edOpen, edTeam, vgTeam, vgItems, edItems };
  };

  const fmtN = (x) => (Math.round(x * 10) / 10).toString().replace(".", ",");
  E.fmtN = fmtN;

  /* ---------- signalering: max 3, gesorteerd op urgentie ---------- */
  E.signals = (data, st, R, horizon, extra) => {
    const out = [];
    const H = Math.min(horizon, R.weeks.length);
    const vgs = R.vgRows; const eds = R.edRows;
    const movable = (it) => it.source !== "bevestigd" || (!it.counts.bezig && !it.counts.review && !it.counts.feedback && !it.counts.bijKlant);
    // Wat-als: verplaats één opdracht en reken opnieuw. Alleen voorstellen die echt helpen.
    const bestMove = (items, kind, fromId, i) => {
      const rows = kind === "vg" ? vgs : eds;
      let best = null;
      for (const it of items) for (const r of rows) {
        if (r.person.id === fromId) continue;
        const st2 = { ...st, moves: { ...st.moves }, vgMoves: { ...st.vgMoves } };
        if (kind === "vg") st2.vgMoves[it.id] = r.person.id; else st2.moves[it.id] = r.person.id;
        const R2 = E.compute(data, st2, R.weeks.length, extra);
        const rows2 = kind === "vg" ? R2.vgRows : R2.edRows;
        const tgt = rows2.find((x) => x.person.id === r.person.id);
        const touched = tgt.cells.filter((c) => (kind === "vg" ? c.items.some((x) => x.id === it.id) : c.parts.some((x) => x.item.id === it.id)));
        if (!touched.length || touched.some((c) => c.key === "grijs" || c.key === "rood" || (kind === "vg" && c.conflicts.length))) continue;
        const peak = Math.max(...touched.map((c) => c.pct || 0));
        const src = fromId ? rows2.find((x) => x.person.id === fromId).cells[i] : null;
        const srcPct = src ? src.pct : null;
        const score = (src && src.key === "rood" ? 1000 : 0) + peak + (srcPct || 0) * 0.3;
        if (!best || score < best.score) best = { item: it, to: r.person, peak, srcPct, score };
      }
      return best;
    };
    const altDay = (it, i) => {
      for (const r of vgs) {
        const c = r.cells[i]; if (!c.cap) continue;
        const d = c.cap.days.find((d) => d !== it.date && c.items.filter((x) => x.date === d).reduce((a, x) => a + x.hours, 0) + it.hours <= (r.person.dayMax || 8));
        if (d) return `Niemand heeft ${E.fmtDayLong(it.date)} ruimte. ${r.person.short || r.person.name} kan wel op ${E.fmtDayLong(d)}: stem verplaatsen af met de klant.`;
      }
      return `Niemand heeft deze week ruimte. Vraag een extra freelance videograaf of verplaats de opname.`;
    };
    for (let i = 0; i < H; i++) {
      // Videografie: overbelasting
      for (const row of vgs) {
        const c = row.cells[i];
        if (c.key !== "rood") continue;
        const p = row.person; const over = c.load - (c.cap ? c.cap.value : 0);
        const cand = [...c.items].sort((a, b) => b.hours - a.hours);
        let advice = null, action = null;
        const bm = bestMove(cand.filter((x) => x.source !== "verwacht"), "vg", p.id, i);
        if (bm) {
          advice = `Wijs ${bm.item.clientName} (${E.fmtDayLong(bm.item.date)}) toe aan ${bm.to.short || bm.to.name}. Daarna: ${p.name} ${bm.srcPct}%, ${bm.to.short || bm.to.name} ${bm.peak}%.`;
          action = { type: "vg", itemId: bm.item.id, to: bm.to.id, label: `Toewijzen aan ${bm.to.short || bm.to.name}` };
        } else {
          const next = vgs.find((r) => r.person.id === p.id).cells.slice(i + 1).find((x) => x.cap && x.cap.value - x.load >= cand[cand.length - 1].hours);
          advice = next ? `Verplaats ${cand[cand.length - 1].clientName} naar ${next.wk.label.toLowerCase()} of zet een freelance videograaf in.` : `Zet een freelance videograaf in; er is geen vrije videograaf in deze week.`;
        }
        out.push({ id: `vg-${p.id}-${c.wk.monday}`, week: i, sev: 100 + (c.pct || 150) - i * 12, area: "Videografie",
          title: c.cap && c.cap.value === 0
            ? `${c.wk.label}: ${p.name} is afwezig, maar er ${c.count === 1 ? "staat 1 opname" : `staan ${c.count} opnames`} op zijn naam${c.items.some((x) => x.source === "verwacht") ? " (verwacht uit pakket)" : ""}.`
            : `${c.wk.label}: ${p.name} heeft ${c.count} opnames gepland (${fmtN(c.load)} uur). Beschikbaar: ${c.cap ? fmtN(c.cap.value) : 0} uur.`,
          advice, action, cell: { kind: "vg", pid: p.id, i } });
      }
      // Videografie: opnames zonder videograaf binnen 3 weken
      const vo = R.vgOpen[i];
      if (vo.count && i < 3) {
        const it = vo.items[0];
        const best = vgs.map((r) => ({ r, c: r.cells[i] })).filter(({ c }) => c.cap && c.cap.days.includes(it.date) && c.cap.value - c.load >= it.hours)
          .sort((a, b) => (b.c.cap.value - b.c.load) - (a.c.cap.value - a.c.load))[0];
        out.push({ id: `vgopen-${vo.wk.monday}`, week: i, sev: 90 - i * 12, area: "Videografie",
          title: `${vo.wk.label}: ${vo.count === 1 ? `opname ${it.clientName} (${E.fmtDayLong(it.date)}) heeft` : `${vo.count} opnames hebben`} nog geen videograaf.`,
          advice: best ? `${best.r.person.short || best.r.person.name} heeft die dag ruimte (nog ${fmtN(best.c.cap.value - best.c.load)} uur vrij).` : altDay(it, i),
          action: best ? { type: "vg", itemId: it.id, to: best.r.person.id, label: `Toewijzen aan ${best.r.person.short || best.r.person.name}` } : null,
          cell: { kind: "vgopen", i } });
      }
      // Editing per editor
      for (const row of eds) {
        const c = row.cells[i];
        if (c.key !== "rood" || !c.cap) continue;
        const p = row.person; const excess = c.load - c.cap.value;
        const best = bestMove(c.parts.map((x) => x.item).filter(movable), "ed", p.id, i);
        let advice, action = null;
        if (best) {
          advice = `Verplaats ${best.item.clientName} (${best.item.videos} video's) naar ${best.to.name}. Daarna: ${best.srcPct === null ? "" : `${p.name} ${best.srcPct}%, `}${best.to.name} maximaal ${best.peak}%.`;
          action = { type: "ed", itemId: best.item.id, to: best.to.id, label: `Verplaatsen naar ${best.to.name}` };
        } else advice = `Verdeel ${Math.ceil(excess)} video's over een freelance editor; de andere editors zitten deze week ook vol.`;
        out.push({ id: `ed-${p.id}-${c.wk.monday}`, week: i, sev: 100 + (c.pct === null ? 130 : c.pct) - i * 12 + (c.conflicts.length ? 15 : 0), area: "Editing",
          title: c.pct === null ? `${c.wk.label}: ${p.name} is afwezig, maar er staat ${fmtN(c.load)} video's werk gepland.` : `${c.wk.label}: ${p.name} ${c.pct}% bezet (${fmtN(c.load)} van ${fmtN(c.cap.value)} video's).`,
          advice, action, cell: { kind: "ed", pid: p.id, i } });
      }
      // Editing zonder editor
      const eo = R.edOpen[i];
      if (eo.load > 0.5 && i < 3 && !out.some((x) => x.itemRef === eo.parts[0].item.id)) {
        const it = eo.parts[0].item; const amt = eo.parts[0].amount;
        const bm = bestMove([it], "ed", null, i);
        out.push({ id: `edopen-${eo.wk.monday}`, week: i, sev: 95 - i * 12, area: "Editing", itemRef: it.id,
          title: `${eo.wk.label}: ${it.clientName} (${it.videos} video's) staat klaar voor editing zonder editor.`,
          advice: bm ? `${bm.to.name} past dit het best: daarna maximaal ${bm.peak}% bezet. Editordeadline: ${E.fmtDayLong(it.editorDue)}.` : `Geen editor met genoeg ruimte: zet een freelance editor in.`,
          action: bm ? { type: "ed", itemId: it.id, to: bm.to.id, label: `Toewijzen aan ${bm.to.name}` } : null,
          cell: { kind: "edopen", i } });
      }
      // Team editing boven 100%
      const t = R.edTeam[i];
      if (t.key === "rood") out.push({ id: `team-${t.wk.monday}`, week: i, sev: 130 + t.pct - i * 12, area: "Editing",
        title: `${t.wk.label}: editingcapaciteit team ${t.pct}% bezet.`, advice: `Verdeel ${Math.ceil(t.load - t.cap)} video's over beschikbare freelance editors, of leg de capaciteit vast van editors die nu nog grijs staan.`, action: null, cell: { kind: "edteam", i } });
    }
    // Structureel: een editor die in veel weken boven 100% zit, krijgt een advies over de vaste klantverdeling.
    for (const row of eds) {
      const reds = row.cells.slice(0, H).filter((c) => c.key === "rood" && c.cap && c.cap.value > 0);
      if (reds.length < 3) continue;
      const others = eds.filter((r) => r.person.id !== row.person.id && r.person.shortsPerWeek).map((r) => {
        const cs = r.cells.slice(0, H).filter((c) => c.pct !== null);
        return { r, avg: Math.round(cs.reduce((a, c) => a + c.pct, 0) / Math.max(1, cs.length)) };
      }).sort((a, b) => a.avg - b.avg);
      const tgt = others[0];
      const mine = data.clients.filter((c) => c.editor === row.person.id).sort((a, b) => a.quota - b.quota);
      const cl = mine[0];
      if (!tgt || !cl) continue;
      out.push({ id: `struct-${row.person.id}`, week: 99, sev: 140, area: "Editing · structureel",
        title: `${row.person.name} zit in ${reds.length} van de komende ${H} weken boven 100%.`,
        advice: `Overweeg ${cl.name} (${cl.quota} video's per maand) als vaste klant naar ${tgt.r.person.name} te verplaatsen. ${tgt.r.person.name} zit gemiddeld op ${tgt.avg}%.`,
        action: null, cell: { kind: "ed", pid: row.person.id, i: row.cells.indexOf(reds[0]) } });
    }
    // Zelfde advies voor meerdere weken (bijv. één project dat twee weken raakt): samenvoegen.
    const merged = [];
    for (const sg of out.sort((a, b) => a.week - b.week)) {
      const twin = sg.action && /^Week \d+: \S+ \d+% bezet/.test(sg.title) && merged.find((m) => m.action && m.action.itemId === sg.action.itemId && m.action.to === sg.action.to && m.area === sg.area && /% bezet/.test(m.title));
      if (twin) {
        twin.weeksMerged = (twin.weeksMerged || [twin.title]).concat(sg.title);
        twin.sev = Math.max(twin.sev, sg.sev) + 5;
        const nums = twin.weeksMerged.map((t) => t.match(/^Week (\d+)/)[1]);
        const pcts = twin.weeksMerged.map((t) => (t.match(/(\d+)% bezet/) || [])[1]).filter(Boolean);
        const who = twin.weeksMerged[0].match(/^Week \d+: (\S+)/)[1];
        const and = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} en ${a[a.length - 1]}` : a[0]);
        twin.title = `Week ${and(nums)}: ${who} ${and(pcts.map((p) => p + "%"))} bezet.`;
        continue;
      }
      merged.push(sg);
    }
    out.length = 0; out.push(...merged);
    const hidden = new Set(st.snoozed || []);
    const visible = out.filter((s) => !hidden.has(s.id)).sort((a, b) => b.sev - a.sev);
    return { all: visible, top: visible.slice(0, 3), hiddenCount: out.length - visible.length };
  };

  /* ---------- simulatie nieuwe klant ---------- */
  E.simulate = (data, st, input) => {
    const shootsPerMonth = Math.max(1, Math.min(4, input.shootsPerMonth || 1));
    const perShoot = Math.round((input.perMonth / shootsPerMonth) * 10) / 10;
    const start = E.nextWorkday(input.start);
    const months = []; let m = start.slice(0, 7);
    for (let k = 0; k < (input.months || 2); k++) { months.push(m); m = E.addDays(m + "-01", 32).slice(0, 7); }
    const lastDay = E.addDays(E.addDays(months[months.length - 1] + "-01", 32).slice(0, 7) + "-01", -1);
    const weekCount = Math.min(20, Math.ceil((toD(E.addDays(lastDay, 21)) - toD(E.mondayOf(E.TODAY))) / 86400000 / 7) + 1);
    const vgs = data.people.filter((p) => p.role === "videograaf");
    const hours = (input.shootHours || 3) + (input.travel || 1.5);
    const sims = []; const plans = [];

    for (const mo of months) {
      for (let k = 0; k < shootsPerMonth; k++) {
        const base = E.compute(data, st, weekCount, sims);
        const opts = [];
        base.weeks.forEach((wk, wi) => {
          base.vgRows.forEach((row) => {
            if (input.vg && input.vg !== "auto" && row.person.id !== input.vg) return;
            const c = row.cells[wi];
            if (!c.cap) return;
            const days = c.cap.days.filter((d) => d.slice(0, 7) === mo && d >= start);
            if (!days.length) return;
            const need = hours + st.settings.setupHours;
            const after = c.load + need;
            const pct = Math.round((after / c.cap.value) * 100);
            // dag met de minste belasting
            const dayLoad = (d) => c.items.filter((x) => x.date === d).reduce((a, x) => a + x.hours, 0);
            const day = [...days].sort((a, b) => dayLoad(a) - dayLoad(b) || (a < b ? -1 : 1))[0];
            const ed = base.edTeam[wi + 1] || base.edTeam[wi];
            const ed2 = base.edTeam[wi + 2] || ed;
            const edPct = Math.max(ed.pct || 0, ed2.pct || 0);
            const score = pct + edPct * 0.6 + (row.person.employment === "freelance" ? 15 : 0) + wi * 0.5;
            opts.push({ wk, wi, vg: row.person, day, pct, edPct, score, fits: pct <= st.settings.orangeMax && dayLoad(day) + need <= (row.person.dayMax || 8) });
          });
        });
        opts.sort((a, b) => (b.fits - a.fits) || a.score - b.score);
        const forced = input.force && input.force[`${mo}-${k}`];
        const chosen = (forced && opts.find((o) => o.wk.monday === forced)) || opts[0];
        // spreiding: bij meerdere opnames per maand niet in dezelfde week
        if (!chosen) { plans.push({ month: mo, key: `${mo}-${k}`, chosen: null, options: [] }); continue; }
        const sid = `sim-${mo}-${k}`;
        sims.push({ id: sid, date: chosen.day, client: "__sim", clientName: input.name || "Nieuwe klant", start: "10:00", dur: input.shootHours || 3, travel: input.travel || 1.5, vg: chosen.vg.id, shorts: perShoot, source: "simulatie", simId: sid });
        const uniqWeeks = []; const seen = new Set();
        for (const o of opts) { const key = o.wk.monday; if (seen.has(key)) continue; seen.add(key); uniqWeeks.push(o); if (uniqWeeks.length === 3) break; }
        if (!uniqWeeks.some((o) => o.wk.monday === chosen.wk.monday)) uniqWeeks.unshift(chosen);
        plans.push({ month: mo, key: `${mo}-${k}`, sid, chosen, options: uniqWeeks.slice(0, 3) });
      }
    }

    // Editor kiezen: laagste piek na toevoegen
    const eds = data.people.filter((p) => p.role === "editor" && p.shortsPerWeek);
    let bestEd = null;
    const candidates = input.editor && input.editor !== "auto" ? eds.filter((e) => e.id === input.editor) : eds;
    for (const e of candidates) {
      const tmp = sims.map((s) => ({ ...s, editor: e.id }));
      const R = E.compute(data, st, weekCount, tmp);
      const row = R.edRows.find((r) => r.person.id === e.id);
      const peak = Math.max(...row.cells.map((c) => (c.parts.some((x) => x.item.simId) ? c.pct || 0 : 0)));
      if (!bestEd || peak < bestEd.peak) bestEd = { editor: e, peak };
    }
    const finalSims = sims.map((s) => ({ ...s, editor: bestEd ? bestEd.editor.id : null }));
    const before = E.compute(data, st, weekCount, []);
    const after = E.compute(data, st, weekCount, finalSims);
    const affected = [];
    after.weeks.forEach((wk, i) => {
      const touchedEd = after.edItems.some((it) => it.simId && wk.days.some((d) => it.daily[d]));
      const touchedVg = finalSims.some((s) => s.date >= wk.monday && s.date <= wk.friday);
      if (touchedEd || touchedVg) affected.push({ wk, i, edBefore: before.edTeam[i], edAfter: after.edTeam[i],
        edPerson: bestEd ? { before: before.edRows.find((r) => r.person.id === bestEd.editor.id).cells[i], after: after.edRows.find((r) => r.person.id === bestEd.editor.id).cells[i] } : null,
        vgBefore: before.vgTeam[i], vgAfter: after.vgTeam[i], touchedEd, touchedVg });
    });
    const redWeeks = affected.filter((a) => a.touchedEd && (a.edAfter.key === "rood" || (a.edPerson && a.edPerson.after.key === "rood")));
    const freelanceNeed = redWeeks.map((a) => ({ wk: a.wk, videos: Math.max(1, Math.ceil(a.edPerson ? a.edPerson.after.load - a.edPerson.after.cap.value : a.edAfter.load - a.edAfter.cap)) }));
    const handovers = after.edItems.filter((it) => it.simId).map((it) => ({ shoot: it.date, from: it.handover, to: it.editorDue, client: it.clientDue, videos: it.videos }));
    return { plans, sims: finalSims, editor: bestEd, affected, freelanceNeed, handovers, weekCount, perShoot };
  };

export default E;
