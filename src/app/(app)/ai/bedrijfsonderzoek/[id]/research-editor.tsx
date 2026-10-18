"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { updateResearchResult, type ResearchResult, type Source } from "@/server/actions/sales-research";
import { Button, Card, CardHeader, InfoNote } from "@/components/ui";

const SLIDES = [
  { key: "bedrijf", label: "Het bedrijf in beeld" },
  { key: "prestaties", label: "Huidige social media" },
  { key: "gaatgoed", label: "Wat gaat goed" },
  { key: "kansen", label: "Grootste kansen" },
  { key: "betekenis", label: "Wat betekent dit" },
  { key: "shortclips", label: "Hoe Shortclips helpt" },
  { key: "ideeen", label: "Video-ideeën" },
  { key: "aanpak", label: "Contentaanpak" },
  { key: "vervolg", label: "Vervolgstappen" },
];

export function ResearchEditor({ id, initial, sources }: { id: string; initial: ResearchResult; sources: Source[] }) {
  const [r, setR] = useState<ResearchResult>(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    setSaved(false);
    start(async () => {
      await updateResearchResult(id, r);
      setSaved(true);
      router.refresh();
    });
  }

  const slidesUit = new Set(r.slidesUit ?? []);
  function toggleSlide(key: string) {
    const next = new Set(slidesUit);
    next.has(key) ? next.delete(key) : next.add(key);
    setR({ ...r, slidesUit: [...next] });
  }

  const empty = !r.bedrijf && !(r.pijnpunten?.length) && !(r.social?.length);

  if (empty) {
    return <InfoNote>Nog geen onderzoeksresultaat. Klik op &quot;Opnieuw onderzoeken&quot; om het onderzoek uit te voeren (vereist een AI-sleutel).</InfoNote>;
  }

  return (
    <div className="space-y-5">
      {r.periodeOnderzocht ? <p className="text-xs text-[var(--color-ink-faint)]">Onderzochte periode: {r.periodeOnderzocht}</p> : null}

      {/* Bedrijf */}
      {r.bedrijf ? (
        <Card>
          <CardHeader title="Het bedrijf" />
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Wat doen ze" v={r.bedrijf.watDoen} />
            <Row k="Producten/diensten" v={r.bedrijf.productenDiensten} />
            <Row k="Regio" v={r.bedrijf.regio} />
            <Row k="Doelgroep" v={r.bedrijf.doelgroep} />
            <Row k="Positionering" v={r.bedrijf.positionering} />
          </dl>
          {r.bedrijf.sterkePunten?.length ? <Bullets title="Sterke punten" items={r.bedrijf.sterkePunten} /> : null}
          {r.bedrijf.aannames?.length ? <Bullets title="Aannames (geen bevestigde feiten)" items={r.bedrijf.aannames} muted /> : null}
        </Card>
      ) : null}

      {/* Social */}
      {r.social?.length ? (
        <Card>
          <CardHeader title="Huidige social media" subtitle="Cijfers die niet openbaar zijn kun je handmatig invullen." />
          <div className="mt-3 space-y-3">
            {r.social.map((s, i) => (
              <div key={i} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{s.platform}{s.gevonden === false ? " (niet gevonden)" : ""}</span>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                    Volgers (handmatig):
                    <input
                      className="sc-input h-8 w-28 py-0 text-xs"
                      value={s.volgers ?? ""}
                      onChange={(e) =>
                        setR({ ...r, social: r.social!.map((x, j) => (j === i ? { ...x, volgers: e.target.value || null } : x)) })
                      }
                      placeholder="—"
                    />
                  </label>
                </div>
                {s.frequentie || s.contentTypes || s.videoAandeel ? (
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {[s.frequentie, s.contentTypes, s.videoAandeel].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {s.observaties?.length ? <ul className="mt-1 list-disc pl-5 text-sm">{s.observaties.map((o, k) => <li key={k}>{o}</li>)}</ul> : null}
                {s.opmerking ? <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{s.opmerking}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Gaat goed */}
      {r.gaatGoed?.length ? (
        <Card>
          <CardHeader title="Wat gaat al goed" />
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{r.gaatGoed.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </Card>
      ) : null}

      {/* Pijnpunten */}
      {r.pijnpunten?.length ? (
        <Card>
          <CardHeader title="Pijnpunten & gemiste kansen" subtitle="Vink uit wat je niet wilt presenteren." />
          <div className="mt-3 space-y-3">
            {r.pijnpunten.map((p, i) => (
              <div key={i} className={`rounded-[var(--radius-md)] border p-3 ${p.uit ? "border-[var(--color-line)] opacity-50" : "border-[var(--color-line)]"}`}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={!p.uit}
                    onChange={() => setR({ ...r, pijnpunten: r.pijnpunten!.map((x, j) => (j === i ? { ...x, uit: !x.uit } : x)) })}
                    className="mt-1 size-4 accent-[var(--color-indigo-ink)]"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">{p.observatie}</span>
                    {p.bewijs ? <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">Bewijs: {p.bewijs}</span> : null}
                    {p.waaromGemisteKans ? <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">Gemiste kans: {p.waaromGemisteKans}</span> : null}
                    {p.shortclipsAanpak ? <span className="mt-0.5 block text-xs text-[var(--color-brand-600)]">Shortclips-aanpak: {p.shortclipsAanpak}</span> : null}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Kansen voor Shortclips */}
      {r.kansenVoorShortclips ? (
        <Card>
          <CardHeader title="Hoe Shortclips kan helpen" />
          <p className="mt-2 text-sm font-medium">{r.kansenVoorShortclips.aanbevolenOplossing}</p>
          <textarea
            className="sc-input mt-2 resize-y text-sm"
            rows={3}
            value={r.kansenVoorShortclips.toelichting ?? ""}
            onChange={(e) => setR({ ...r, kansenVoorShortclips: { ...r.kansenVoorShortclips, toelichting: e.target.value } })}
          />
        </Card>
      ) : null}

      {/* Video-ideeën */}
      {r.videoIdeeen?.length ? (
        <Card>
          <CardHeader title="Video-ideeën" subtitle="Selecteer welke je meeneemt in de presentatie." />
          <div className="mt-3 space-y-3">
            {r.videoIdeeen.map((v, i) => (
              <div key={i} className={`rounded-[var(--radius-md)] border border-[var(--color-line)] p-3 ${v.uit ? "opacity-50" : ""}`}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={!v.uit}
                    onChange={() => setR({ ...r, videoIdeeen: r.videoIdeeen!.map((x, j) => (j === i ? { ...x, uit: !x.uit } : x)) })}
                    className="mt-1 size-4 accent-[var(--color-indigo-ink)]"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">{v.titel}</span>
                    {v.hook ? <span className="mt-0.5 block text-xs text-[var(--color-brand-600)]">Hook: {v.hook}</span> : null}
                    {v.uitleg ? <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">{v.uitleg}</span> : null}
                    {v.doel ? <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">Doel: {v.doel}</span> : null}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Concurrenten */}
      {r.concurrenten?.length ? (
        <Card>
          <CardHeader title="Concurrenten" />
          <div className="mt-3 space-y-2 text-sm">
            {r.concurrenten.map((c, i) => (
              <div key={i}>
                <span className="font-medium">{c.naam}</span>
                {c.watWerkt ? <span className="text-[var(--color-ink-muted)]"> — werkt: {c.watWerkt}</span> : null}
                {c.kansVoorKlant ? <span className="block text-xs text-[var(--color-ink-faint)]">Kans: {c.kansVoorKlant}</span> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Vervolgstappen */}
      <Card>
        <CardHeader title="Vervolgstappen" />
        <textarea className="sc-input mt-2 resize-y text-sm" rows={2} value={r.vervolgstappen ?? ""} onChange={(e) => setR({ ...r, vervolgstappen: e.target.value })} />
      </Card>

      {/* Slides + bronnen */}
      <Card>
        <CardHeader title="Slides in de presentatie" subtitle="Zet slides uit die je niet wilt tonen." />
        <div className="mt-3 flex flex-wrap gap-2">
          {SLIDES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => toggleSlide(s.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${slidesUit.has(s.key) ? "bg-[var(--color-surface-2)] text-[var(--color-ink-faint)] line-through" : "bg-[var(--color-indigo-ink)] text-white"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {sources.length ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Bronnen</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {sources.map((s, i) => (
                <li key={i}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-600)] hover:underline">{s.label || s.url}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {r.kwaliteitscheck ? <p className="mt-3 text-xs text-[var(--color-ink-faint)]">Kwaliteitscontrole: {r.kwaliteitscheck}</p> : null}
      </Card>

      <div className="sticky bottom-4 flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saved ? "Opgeslagen" : "Wijzigingen opslaan"}
        </Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
function Bullets({ title, items, muted }: { title: string; items: string[]; muted?: boolean }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{title}</p>
      <ul className={`mt-1 list-disc space-y-0.5 pl-5 text-sm ${muted ? "text-[var(--color-ink-muted)]" : ""}`}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
