"use client";

/** Confetti + geluid voor de award-viering. Alles client-side, geluid pas na een klik. */

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function fireConfetti(color: string): Promise<void> {
  if (prefersReducedMotion()) return;
  const mod = await import("canvas-confetti");
  const confetti = mod.default;
  const colors = [color, "#ffffff", "#e8bf52"];
  const end = Date.now() + 2500;
  (function frame() {
    confetti({ particleCount: 4, angle: 60, spread: 62, startVelocity: 48, origin: { x: 0, y: 0.75 }, colors });
    confetti({ particleCount: 4, angle: 118, spread: 62, startVelocity: 48, origin: { x: 1, y: 0.75 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export function playAwardSound(): void {
  try {
    const audio = new Audio("/sounds/award.mp3");
    audio.volume = 0.5;
    const p = audio.play();
    if (p && typeof p.catch === "function") p.catch(() => playFallbackTone());
  } catch {
    playFallbackTone();
  }
}

/** Terugval als het mp3-bestand niet speelt: een korte oplopende reeks tonen. */
function playFallbackTone(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const t = ctx.currentTime + i * 0.1;
      const dur = i === notes.length - 1 ? 0.5 : 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    });
  } catch {
    /* geen geluid beschikbaar */
  }
}
