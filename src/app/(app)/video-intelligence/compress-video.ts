/**
 * Verkleint een video in de browser vóór het uploaden: schaalt terug naar max
 * 1280px (720p-achtig) en her-encodeert met een lagere bitrate. Zo past een zware
 * 4K-export ruim onder de opslaglimiet, terwijl de analyse (shots, montage, hook,
 * AI-duiding) er niet onder lijdt. Gebruikt de hardware-decoder van de browser
 * (video-element + canvas + MediaRecorder), dus ook grote bestanden lukken.
 *
 * Werkt in Chrome/Edge/Firefox. Lukt het niet (bijv. niet-ondersteunde browser),
 * dan gooit het een fout en valt de upload terug op het originele bestand.
 */

const MAX_SIDE = 1280;
const VIDEO_BITRATE = 2_500_000; // ~2,5 Mbps → 720p blijft scherp, bestand blijft klein

function pickMime(): string {
  const prefs = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const supported = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
  if (supported) {
    for (const m of prefs) if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

export function canCompress(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof document !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

export async function compressVideo(file: File, onProgress: (pct: number) => void): Promise<File> {
  if (!canCompress()) throw new Error("Verkleinen niet ondersteund in deze browser.");

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  video.src = URL.createObjectURL(file);
  document.body.appendChild(video);

  const cleanup = () => {
    try { URL.revokeObjectURL(video.src); } catch { /* al opgeruimd */ }
    video.remove();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Kon de video niet lezen."));
    });

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const duration = video.duration;
    if (!vw || !vh) throw new Error("Ongeldige video-afmetingen.");

    const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    const w = Math.max(2, Math.round((vw * scale) / 2) * 2);
    const h = Math.max(2, Math.round((vh * scale) / 2) * 2);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas niet beschikbaar.");

    const canvasStream = canvas.captureStream(30);
    const tracks: MediaStreamTrack[] = [canvasStream.getVideoTracks()[0]!];
    // Audio meenemen voor latere transcriptie (best effort).
    try {
      const withCapture = video as HTMLVideoElement & { captureStream?: () => MediaStream };
      const audioTrack = withCapture.captureStream?.().getAudioTracks()[0];
      if (audioTrack) tracks.push(audioTrack);
    } catch { /* geen audio is prima */ }
    const mixed = new MediaStream(tracks);

    const mime = pickMime();
    const recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    await video.play();
    recorder.start(1000);

    let raf = 0;
    const draw = () => {
      ctx.drawImage(video, 0, 0, w, h);
      if (duration && Number.isFinite(duration)) onProgress(Math.min(99, Math.round((video.currentTime / duration) * 100)));
      raf = requestAnimationFrame(draw);
    };
    draw();

    await new Promise<void>((resolve) => { video.onended = () => resolve(); });
    cancelAnimationFrame(raf);
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    onProgress(100);

    const blob = new Blob(chunks, { type: mime });
    if (blob.size === 0) throw new Error("Verkleinen leverde een leeg bestand op.");
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    const base = file.name.replace(/\.[^.]+$/, "") || "video";
    return new File([blob], `${base}_720p.${ext}`, { type: mime });
  } finally {
    cleanup();
  }
}
