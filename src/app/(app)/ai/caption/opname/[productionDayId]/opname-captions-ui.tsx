"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, Clock, Loader2, RefreshCw, Sparkles } from "lucide-react";
import {
  markShootCaptionsChecked,
  regenerateCaptionItem,
  regenerateShootCaptions,
  updateCaptionItem,
} from "@/server/actions/captions";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton } from "../../../_shared";
import { CAPTION_STATUS, type CaptionListStatus } from "../../caption-status";
import { DriveScriptPicker } from "../../drive-script-picker";
import { ExternalLink, HardDrive } from "lucide-react";

const PLATFORMS = "Instagram · TikTok · Facebook · YouTube Shorts";

type Item = {
  id: string;
  position: number;
  shortTitle: string;
  hook: string;
  caption: string;
  hashtags: string[];
  status: "gegenereerd" | "bewerkt";
  isEdited: boolean;
  staleFromNewVersion: boolean;
};

type Detail = {
  productionDayId: string;
  clientName: string;
  scheduledOn: string;
  title: string;
  hasPdf: boolean;
  set: {
    id: string;
    status: CaptionListStatus;
    generatedAt: string | null;
    errorMessage: string | null;
    checkedByName: string | null;
    checkedAt: string | null;
  } | null;
  driveSource: {
    status: "gekoppeld" | "suggestie" | "afgewezen";
    fileName: string;
    url: string | null;
    matchReason: string | null;
  } | null;
  items: Item[];
};

function exportShort(it: Item, i: number): string {
  const tags = it.hashtags.length ? `\n\n${it.hashtags.join(" ")}` : "";
  return `SHORT ${i + 1}: ${it.shortTitle}\n\n${it.caption}${tags}`;
}

export function OpnameCaptions({ detail }: { detail: Detail }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(detail.items);
  const [regenAll, startRegenAll] = useTransition();
  const [checking, startCheck] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const status = detail.set?.status ?? (detail.hasPdf ? "wacht" : "pdf_ontbreekt");
  const st = CAPTION_STATUS[status];

  function updateLocal(id: string, next: Partial<Item>) {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }

  function regenerateAll() {
    if (!window.confirm("Alle captions voor deze opname opnieuw genereren? Handmatig bewerkte captions blijven behouden.")) return;
    setErr(null);
    startRegenAll(async () => {
      const res = await regenerateShootCaptions(detail.productionDayId);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Genereren mislukt.");
    });
  }

  function markChecked() {
    setErr(null);
    startCheck(async () => {
      const res = await markShootCaptionsChecked(detail.productionDayId);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Mislukt.");
    });
  }

  const allText = items.map((it, i) => exportShort(it, i)).join("\n\n———\n\n");
  const busy = status === "bezig";

  return (
    <div className="space-y-5">
      {/* Statusblok + hoofdacties */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            {detail.set?.generatedAt ? (
              <span className="text-xs text-[var(--color-ink-faint)]">
                {items.length} caption{items.length === 1 ? "" : "s"} · laatst gegenereerd {fmtDateTime(detail.set.generatedAt)}
              </span>
            ) : null}
            {detail.set?.checkedByName && status === "gecontroleerd" ? (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-good)]">
                <CheckCircle2 className="size-3.5" /> door {detail.set.checkedByName}
              </span>
            ) : null}
          </div>
          {items.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton label="Alle captions kopiëren" text={allText} />
              <Button variant="secondary" size="sm" onClick={regenerateAll} disabled={regenAll}>
                {regenAll ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Alle opnieuw genereren
              </Button>
              {status !== "gecontroleerd" ? (
                <Button size="sm" onClick={markChecked} disabled={checking}>
                  {checking ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Markeer als gecontroleerd
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>

      {/* Scriptbron uit Google Drive: welke PDF voedt de captions, met de optie om
          een ander/nieuwer script te kiezen of de laatste versie opnieuw op te halen. */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <HardDrive className="size-4 shrink-0 text-[var(--color-brand-600)]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Scriptbron (Google Drive)</p>
              {detail.driveSource?.status === "gekoppeld" ? (
                <p className="truncate text-xs text-[var(--color-ink-muted)]">
                  Captions gemaakt uit: <span className="font-medium text-[var(--color-ink)]">{detail.driveSource.fileName}</span>
                  {detail.driveSource.url ? (
                    <a href={detail.driveSource.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-[var(--color-brand-600)] hover:underline">
                      openen <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </p>
              ) : (
                <p className="text-xs text-[var(--color-ink-muted)]">
                  Nog geen script uit Drive gekoppeld — kies de juiste PDF zodat de captions automatisch gemaakt worden.
                </p>
              )}
            </div>
          </div>
          <DriveScriptPicker productionDayId={detail.productionDayId} variant="button" hasCoupledSource={detail.driveSource?.status === "gekoppeld"} />
        </div>
      </Card>

      {/* Lege/bezig/mislukt-toestanden */}
      {items.length === 0 ? (
        <Card>
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Loader2 className="size-4 animate-spin" /> De captions worden gegenereerd. Dit kan even duren — ververs de pagina zo.
            </p>
          ) : status === "mislukt" ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-[var(--color-bad)]">
                <AlertTriangle className="size-4" /> Genereren is mislukt{detail.set?.errorMessage ? `: ${detail.set.errorMessage}` : "."}
              </p>
              <Button size="sm" onClick={regenerateAll} disabled={regenAll}>
                {regenAll ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Opnieuw proberen
              </Button>
            </div>
          ) : !detail.hasPdf ? (
            <p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Clock className="size-4" /> Er staat nog geen scriptcontrole-PDF klaar voor deze opname. Zodra de scripts ter controle worden gezet, maakt het systeem automatisch captions.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-ink-muted)]">De scripts staan klaar, maar er zijn nog geen captions gegenereerd.</p>
              <Button size="sm" onClick={regenerateAll} disabled={regenAll}>
                {regenAll ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Genereer captions
              </Button>
            </div>
          )}
        </Card>
      ) : null}

      {/* De captions */}
      {items.map((it, i) => (
        <CaptionItemCard key={it.id} index={i} item={it} onLocalChange={(next) => updateLocal(it.id, next)} />
      ))}
    </div>
  );
}

function CaptionItemCard({
  index,
  item,
  onLocalChange,
}: {
  index: number;
  item: Item;
  onLocalChange: (next: Partial<Item>) => void;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [pending, startRegen] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onEdit(value: string) {
    onLocalChange({ caption: value, isEdited: true, status: "bewerkt", staleFromNewVersion: false });
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await updateCaptionItem(item.id, value);
      setSaveState(res.ok ? "saved" : "idle");
      if (!res.ok) setErr(res.message ?? "Opslaan mislukt.");
      else setTimeout(() => setSaveState("idle"), 1500);
    }, 700);
  }

  function regen(variant?: "variatie" | "met_cta" | "zonder_cta" | "korter" | "langer") {
    setErr(null);
    startRegen(async () => {
      const res = await regenerateCaptionItem(item.id, variant);
      if (!res.ok) setErr(res.message ?? "Opnieuw genereren mislukt.");
      else {
        // Server heeft het item vervangen; haal de verse waarde op bij refresh.
        window.location.reload();
      }
    });
  }

  const tags = item.hashtags.length ? `\n\n${item.hashtags.join(" ")}` : "";
  const full = `${item.caption}${tags}`.trim();

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Short {index + 1}: <span className="font-normal text-[var(--color-ink-muted)]">{item.shortTitle}</span>
        </h3>
        <div className="flex items-center gap-1.5">
          {item.staleFromNewVersion ? <Badge tone="violet">Nieuwere versie beschikbaar</Badge> : null}
          {item.isEdited ? <Badge tone="info">Handmatig bewerkt</Badge> : null}
          <CopyButton text={full} />
          <Button size="sm" variant="ghost" onClick={() => regen()} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Opnieuw genereren
          </Button>
        </div>
      </div>
      {item.hook ? <p className="mb-3 text-xs text-[var(--color-ink-faint)]">Hook: {item.hook}</p> : null}

      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Caption · {PLATFORMS}</span>
          <span className="text-2xs text-[var(--color-ink-faint)]">
            {saveState === "saving" ? "Opslaan…" : saveState === "saved" ? "Opgeslagen ✓" : ""}
          </span>
        </div>
        <textarea
          className="sc-input resize-y text-sm"
          rows={4}
          value={item.caption}
          onChange={(e) => onEdit(e.target.value)}
        />
        <div className="mt-3">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Eventueel toepasbare hashtags</span>
          {item.hashtags.length ? (
            <p className="mt-1 text-sm text-[var(--color-brand-600)]">{item.hashtags.join(" ")}</p>
          ) : (
            <p className="mt-1 text-sm text-[var(--color-ink-faint)]">Geen hashtags voorgesteld.</p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          <span className="text-2xs text-[var(--color-ink-faint)]">Andere versie:</span>
          {([
            { key: "met_cta", label: "Met CTA" },
            { key: "zonder_cta", label: "Zonder CTA" },
            { key: "korter", label: "Korter" },
            { key: "langer", label: "Langer" },
          ] as const).map((v) => (
            <button
              key={v.key}
              type="button"
              disabled={pending}
              onClick={() => regen(v.key)}
              className="rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
