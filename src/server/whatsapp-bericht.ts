import "server-only";
import { getStringSetting } from "@/server/app-settings";
import { DEFAULT_WHATSAPP_BERICHT, WHATSAPP_OPTIES, WHATSAPP_SETTING_KEYS, type WhatsappOptie } from "@/lib/whatsapp-bericht";

/** De actuele standaardteksten (centraal aanpasbaar door beheerders, anders de vaste tekst). */
export async function getWhatsappStandaarden(): Promise<Record<WhatsappOptie, string>> {
  const entries = await Promise.all(
    WHATSAPP_OPTIES.map(async (o) => {
      try {
        const v = await getStringSetting(WHATSAPP_SETTING_KEYS[o], DEFAULT_WHATSAPP_BERICHT[o]);
        return [o, v.trim() ? v : DEFAULT_WHATSAPP_BERICHT[o]] as const;
      } catch {
        return [o, DEFAULT_WHATSAPP_BERICHT[o]] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<WhatsappOptie, string>;
}
