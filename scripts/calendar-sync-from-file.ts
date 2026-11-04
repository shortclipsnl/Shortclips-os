/**
 * Noodroute: de normale agenda-sync draaien met afspraken uit een JSON-bestand
 * (Google Agenda-export van de agenda "Team Shortclips afspraken"), voor als
 * het Google-token verlopen is. Zelfde logica als de uursync: klant koppelen,
 * opnames afleiden, annuleringen en dubbelingen opruimen.
 *
 * Het bestand moet het VOLLEDIGE venster bevatten (30 dagen terug t/m 120
 * dagen vooruit), anders worden ontbrekende afspraken als geannuleerd gezien.
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/calendar-sync-from-file.ts events.json
 */
import fs from "node:fs";
async function main() {
  const file = process.argv[2]!;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
  const events = raw.map((e) => ({ ...e, hangoutLink: (e.hangoutLink as string) ?? (e.conferenceUrl as string) ?? undefined }));
  const { runCalendarSync } = await import("@/server/jobs/calendar-sync");
  const res = await runCalendarSync({
    source: {
      isConfigured: true,
      configuredCalendarIds: ["teamshortclips@gmail.com"],
      async listCalendars() { return [{ id: "teamshortclips@gmail.com", summary: "Team Shortclips afspraken" }]; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async listEvents() { return events as any; },
    },
  });
  console.log(JSON.stringify(res, null, 1).slice(0, 3000));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
