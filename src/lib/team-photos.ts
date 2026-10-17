/**
 * Centrale teamfoto-resolutie. Eén bron van waarheid i.p.v. de hardcoded mapping
 * die eerder in team/page.tsx en login/team-marquee.tsx los stond.
 *
 * Volgorde: expliciete `avatarUrl` uit de database → bekende portretfoto in
 * public/team/ (op voornaam) → undefined (de Avatar toont dan initialen op de
 * persoonskleur). Nooit een willekeurige afbeelding.
 *
 * Let op: het bestand voor Jiska heet historisch "jeska.png".
 */
const TEAM_PHOTO_FILE: Record<string, string> = {
  fabian: "fabian",
  jarno: "jarno",
  jiska: "jeska",
  jeska: "jeska",
  max: "max",
  milou: "milou",
  nynke: "nynke",
  quinn: "quinn",
  rutger: "rutger",
  sem: "sem",
};

/** Bekende portretfoto op voornaam (public/team/<naam>.png), of undefined. */
export function knownTeamPhoto(fullName: string | null | undefined): string | undefined {
  const first = (fullName ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const file = TEAM_PHOTO_FILE[first];
  return file ? `/team/${file}.png` : undefined;
}

/**
 * De beste beschikbare fotobron voor een teamlid: de opgeslagen avatarUrl krijgt
 * voorrang, anders de bekende portretfoto. `null` → geen foto (initialen-avatar).
 */
export function teamPhotoSrc(fullName: string | null | undefined, avatarUrl?: string | null): string | null {
  if (avatarUrl && avatarUrl.trim()) return avatarUrl;
  return knownTeamPhoto(fullName) ?? null;
}
