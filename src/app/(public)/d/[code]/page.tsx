import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicTransfer } from "@/server/transfer/service";
import { DownloadPanel } from "./download-ui";

export const metadata: Metadata = {
  title: "Download — Shortclips Transfer",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export default async function DownloadPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await getPublicTransfer(code);
  if (!t) notFound();

  const uploading = t.status === "uploading";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shortclips-logo-onlight.png" alt="Shortclips" className="mx-auto mb-6 h-8 w-auto" />
        <h1 className="text-center text-lg font-semibold text-[#00003b]">Er zijn bestanden met je gedeeld</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          {t.files.length} bestand{t.files.length === 1 ? "" : "en"} · {fmtBytes(t.totalBytes)}
        </p>

        <div className="mt-5 max-h-64 space-y-1.5 overflow-auto">
          {t.files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-800">{f.fileName}</span>
              <span className="shrink-0 text-xs text-slate-400 tabular-nums">{fmtBytes(f.sizeBytes)}</span>
            </div>
          ))}
        </div>

        <div className="mt-6">
          {uploading ? (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
              De bestanden worden nog geüpload. Ververs deze pagina zo — de download wordt actief zodra alles klaar is.
            </div>
          ) : !t.downloadable ? (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
              Deze downloadlink is verlopen. Vraag de afzender om de transfer opnieuw te activeren.
            </div>
          ) : (
            <DownloadPanel code={t.code} files={t.files} />
          )}
        </div>

        {!uploading && t.downloadable ? (
          <p className="mt-4 text-center text-xs text-slate-400">Downloadbaar tot {fmtDate(t.downloadExpiresOn)}.</p>
        ) : null}
      </div>
    </div>
  );
}
