import "server-only";
import { getStringSetting } from "@/server/app-settings";
import { DEFAULT_KLANTBERICHT, KLANTBERICHT_SETTING_KEY } from "@/lib/klantbericht";

/** Het actuele standaard klantbericht (centraal aanpasbaar, anders de standaardtekst). */
export async function getKlantbericht(): Promise<string> {
  try {
    const v = await getStringSetting(KLANTBERICHT_SETTING_KEY, DEFAULT_KLANTBERICHT);
    return v.trim() ? v : DEFAULT_KLANTBERICHT;
  } catch {
    return DEFAULT_KLANTBERICHT;
  }
}
