/**
 * Een herkenbare, consistente cover-kleur per video, afgeleid van de titel.
 * Zolang Frame.io-thumbnails (verlopende URL's) nog niet gekoppeld zijn, geeft
 * dit elke video een eigen visueel kenmerk zodat de klant 'm herkent.
 */
export function videoCover(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 38) % 360;
  return `linear-gradient(160deg, hsl(${hue} 52% 20%), hsl(${hue2} 68% 40%))`;
}
