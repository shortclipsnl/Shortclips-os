import "server-only";
import { notify } from "@/server/notifications";
import { maakAvond, maakOchtend, maakWeek } from "@/server/coach/engine";
import { getDag, getWeek } from "@/server/coach/store";
import { amsDate, amsHour, amsWeekday, isoWeekId } from "@/server/coach/time";
import { runJob } from "./runner";

/**
 * Coach (alleen eigenaar). Elke taak heeft twee cron-slots (zomer- en
 * wintertijd); de uurcheck laat hem precies één keer op het juiste lokale uur
 * doorkomen. Dedupe via het opgeslagen dagdocument.
 */

const kort = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runCoachOchtend() {
  return runJob("system", "coach.ochtend", {}, async (ctx) => {
    const wd = amsWeekday();
    if (wd === "Sat" || wd === "Sun" || amsHour() !== 7) {
      ctx.log(`Lokaal ${wd} ${amsHour()}:xx, niet rond 07:xx op een werkdag. Overgeslagen.`);
      return;
    }
    const datum = amsDate();
    if ((await getDag(datum))?.ochtend) {
      ctx.log("Ochtendcontrole van vandaag bestaat al.");
      return;
    }
    const o = await maakOchtend(datum);
    ctx.log(`Ochtendcontrole gemaakt: ${o.acties.length} acties.`);
    await notify({
      roles: ["owner"],
      type: "coach_ochtend",
      level: "info",
      title: kort(`Vandaag: ${o.acties.map((a) => a.wat).join(" | ")}`, 120),
      body: kort(o.kern, 200),
      href: "/coach",
      dedupeKey: `coach_ochtend:${datum}`,
    });
  });
}

export async function runCoachAvond() {
  return runJob("system", "coach.avond", {}, async (ctx) => {
    const wd = amsWeekday();
    if (!["Mon", "Tue", "Wed", "Thu"].includes(wd) || amsHour() !== 17) {
      ctx.log(`Lokaal ${wd} ${amsHour()}:xx, niet rond 17:xx op ma t/m do. Overgeslagen.`);
      return;
    }
    const datum = amsDate();
    const dag = await getDag(datum);
    if (dag?.avond?.status === "definitief") {
      ctx.log("Avondcontrole is al definitief.");
      return;
    }
    const a = await maakAvond(datum);
    ctx.log(`Voorlopige avondscore ${a.gewogen}.`);
    await notify({
      roles: ["owner"],
      type: "coach_avond",
      level: "info",
      title: `Score ${a.gewogen.toLocaleString("nl-NL")} (voorlopig). Vul je avondcheck in`,
      body: kort(`Morgen: ${a.actieMorgen}`, 200),
      href: "/coach#avond",
      dedupeKey: `coach_avond:${datum}`,
    });
  });
}

export async function runCoachWeek() {
  return runJob("system", "coach.week", {}, async (ctx) => {
    const wd = amsWeekday();
    if (wd !== "Fri" || amsHour() !== 16) {
      ctx.log(`Lokaal ${wd} ${amsHour()}:xx, niet vrijdag rond 16:xx. Overgeslagen.`);
      return;
    }
    const datum = amsDate();
    const id = isoWeekId(datum);
    if (await getWeek(id)) {
      ctx.log(`Weekrapport ${id} bestaat al.`);
      return;
    }
    // Eerst de vrijdag zelf voorlopig beoordelen, dan het weekrapport.
    const dag = await getDag(datum);
    if (!dag?.avond) await maakAvond(datum).catch((e) => ctx.log(`Vrijdagscore mislukt: ${e instanceof Error ? e.message : e}`));
    const w = await maakWeek(datum);
    ctx.log(`Weekrapport ${id} gemaakt, gemiddelde ${w.gemiddeldeScore ?? "onbekend"}.`);
    await notify({
      roles: ["owner"],
      type: "coach_week",
      level: "info",
      title: kort(`Week ${id.slice(-2)}: score ${w.gemiddeldeScore?.toLocaleString("nl-NL") ?? "onbekend"}. ${w.prioriteiten[0]?.wat ?? ""}`, 120),
      body: kort(w.waarheid, 200),
      href: `/coach?week=${id}`,
      dedupeKey: `coach_week:${id}`,
    });
  });
}
