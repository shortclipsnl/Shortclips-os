import type { Tone } from "@/components/ui";

/** Afgeleide caption-status voor opnames (zie server/captions/service.ts). */
export type CaptionListStatus =
  | "pdf_ontbreekt"
  | "wacht"
  | "bezig"
  | "klaar_controle"
  | "gedeeltelijk"
  | "bijgewerkt_script"
  | "gecontroleerd"
  | "mislukt";

/** Label + kleur per status — één bron van waarheid voor alle caption-weergaves. */
export const CAPTION_STATUS: Record<CaptionListStatus, { label: string; tone: Tone }> = {
  pdf_ontbreekt: { label: "PDF ontbreekt", tone: "neutral" },
  wacht: { label: "Nog te genereren", tone: "info" },
  bezig: { label: "Bezig met genereren", tone: "info" },
  klaar_controle: { label: "Klaar voor controle", tone: "warn" },
  gedeeltelijk: { label: "Gedeeltelijk gereed", tone: "warn" },
  bijgewerkt_script: { label: "Bijgewerkt script", tone: "violet" },
  gecontroleerd: { label: "Gecontroleerd", tone: "good" },
  mislukt: { label: "Mislukt", tone: "bad" },
};
