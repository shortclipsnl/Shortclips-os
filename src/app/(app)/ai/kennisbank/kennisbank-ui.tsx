"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  deleteKnowledgeItem,
  saveClientAiProfile,
  saveKnowledgeItem,
} from "@/server/actions/ai-tools";
import type {
  CaptionProfile,
  CommunicationProfile,
  EditingProfile,
} from "@/server/ai/knowledge";
import { Button, Card, CardHeader, ErrorNote, InfoNote } from "@/components/ui";
import { ToolHowTo } from "../_shared";

const CATEGORIES = ["branding", "schrijfstijl", "productie", "editing", "communicatie", "kwaliteit", "escalatie", "algemeen"];

export type KnowledgeItem = { id: string; category: string; title: string; body: string };

export function KnowledgeManager({ items }: { items: KnowledgeItem[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-5">
      <ToolHowTo>
        Leg hier per klant de vaste afspraken, de gewenste toon en terugkerende correcties vast. De andere AI-tools gebruiken deze kennis automatisch, zodat hun output beter bij de klant past.
      </ToolHowTo>
      <Card padded={false}>
      <div className="flex items-center justify-between p-5 pb-3">
        <CardHeader title="Centrale Shortclips-kennis" subtitle="Branding, werkwijze, editingrichtlijnen, communicatie. Gebruikt door alle AI Tools." />
        <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" /> Toevoegen
        </Button>
      </div>
      <div className="space-y-2 px-5 pb-5">
        {adding ? <KnowledgeForm onDone={() => setAdding(false)} /> : null}
        {items.length === 0 && !adding ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen kennis toegevoegd.</p>
        ) : null}
        {items.map((it) => (
          <KnowledgeRow key={it.id} item={it} />
        ))}
      </div>
      </Card>
    </div>
  );
}

function KnowledgeRow({ item }: { item: KnowledgeItem }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (editing) return <KnowledgeForm item={item} onDone={() => setEditing(false)} />;
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{item.category}</span>
          <p className="text-sm font-medium">{item.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-ink-muted)]">{item.body}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => setEditing(true)} className="rounded px-2 py-1 text-xs text-[var(--color-brand-600)] hover:underline">Bewerken</button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await deleteKnowledgeItem(item.id); router.refresh(); })}
            className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"
            aria-label="Verwijderen"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function KnowledgeForm({ item, onDone }: { item?: KnowledgeItem; onDone: () => void }) {
  const [category, setCategory] = useState(item?.category ?? "algemeen");
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-3">
      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <select className="sc-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="sc-input" placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <textarea className="sc-input mt-2 resize-y text-sm" rows={4} placeholder="Inhoud" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !title.trim() || !body.trim()}
          onClick={() =>
            start(async () => {
              const res = await saveKnowledgeItem({ id: item?.id, category, title, body });
              if (res.ok) { onDone(); router.refresh(); }
              else setErr(res.message ?? "Mislukt");
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Opslaan
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Annuleren</Button>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}

/* --- Klantprofiel --- */

export function ProfileForm({
  clientId,
  clientName,
  caption,
  editing,
  communication,
}: {
  clientId: string;
  clientName: string;
  caption: CaptionProfile;
  editing: EditingProfile;
  communication: CommunicationProfile;
}) {
  const [cap, setCap] = useState<CaptionProfile>(caption);
  const [edit, setEdit] = useState<EditingProfile>(editing);
  const [comm, setComm] = useState<CommunicationProfile>(communication);
  const [examples, setExamples] = useState((caption.voorbeelden ?? []).join("\n---\n"));
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    start(async () => {
      const voorbeelden = examples.split(/\n-{2,}\n/).map((s) => s.trim()).filter(Boolean);
      const res = await saveClientAiProfile({
        clientId,
        captionProfile: { ...cap, voorbeelden },
        editingProfile: edit,
        communicationProfile: comm,
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  const set = <K extends keyof CaptionProfile>(k: K, v: string) => setCap((c) => ({ ...c, [k]: v }));

  return (
    <Card>
      <CardHeader title={`Profiel: ${clientName}`} subtitle="Caption-stijl, editingvoorkeuren en communicatieafspraken. Blijft opgeslagen." />
      <div className="mt-4 space-y-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Captions</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Branche"><input className="sc-input" value={cap.branche ?? ""} onChange={(e) => set("branche", e.target.value)} /></Field>
            <Field label="Doelgroep"><input className="sc-input" value={cap.doelgroep ?? ""} onChange={(e) => set("doelgroep", e.target.value)} /></Field>
            <Field label="Tone of voice"><input className="sc-input" value={cap.toneOfVoice ?? ""} onChange={(e) => set("toneOfVoice", e.target.value)} /></Field>
            <Field label="Schrijfstijl"><input className="sc-input" value={cap.schrijfstijl ?? ""} onChange={(e) => set("schrijfstijl", e.target.value)} /></Field>
            <Field label="Emoji-gebruik"><input className="sc-input" value={cap.emojiGebruik ?? ""} onChange={(e) => set("emojiGebruik", e.target.value)} placeholder="Bijv. spaarzaam, passend bij merk" /></Field>
            <Field label="Hashtagvoorkeuren"><input className="sc-input" value={cap.hashtagVoorkeuren ?? ""} onChange={(e) => set("hashtagVoorkeuren", e.target.value)} /></Field>
            <Field label="Captionlengte Instagram"><input className="sc-input" value={cap.lengteInstagram ?? ""} onChange={(e) => set("lengteInstagram", e.target.value)} placeholder="Bijv. 3-5 zinnen" /></Field>
            <Field label="Captionlengte TikTok"><input className="sc-input" value={cap.lengteTiktok ?? ""} onChange={(e) => set("lengteTiktok", e.target.value)} placeholder="Bijv. 1-2 korte zinnen" /></Field>
            <Field label="Vaste afsluiting"><input className="sc-input" value={cap.vasteAfsluiting ?? ""} onChange={(e) => set("vasteAfsluiting", e.target.value)} /></Field>
            <Field label="Contactgegevens" hint="Alleen deze worden gebruikt — nooit verzonnen."><input className="sc-input" value={cap.contactgegevens ?? ""} onChange={(e) => set("contactgegevens", e.target.value)} placeholder="Website · telefoon · e-mail · plaats" /></Field>
          </div>
          <div className="mt-3">
            <Field label="Eerder goedgekeurde captions (scheid met een regel ---)" hint="De AI leert hiervan de schrijfstijl.">
              <textarea className="sc-input resize-y text-sm" rows={5} value={examples} onChange={(e) => setExamples(e.target.value)} placeholder={"Voorbeeldcaption 1\n---\nVoorbeeldcaption 2"} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Editingvoorkeuren</h3>
          <textarea className="sc-input resize-y text-sm" rows={3} value={edit.aandachtspunten ?? ""} onChange={(e) => setEdit({ ...edit, aandachtspunten: e.target.value })} placeholder="Klantspecifieke editingafspraken." />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Communicatieafspraken</h3>
          <textarea className="sc-input resize-y text-sm" rows={3} value={comm.afspraken ?? ""} onChange={(e) => setComm({ ...comm, afspraken: e.target.value })} placeholder="Afspraken die gelden voor berichten aan deze klant." />
        </section>

        <div className="flex items-center gap-3 border-t border-[var(--color-line)] pt-4">
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Profiel opslaan
          </Button>
          {result ? (result.ok ? <InfoNote tone="good">Opgeslagen.</InfoNote> : <ErrorNote>{result.message}</ErrorNote>) : null}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="sc-label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{hint}</p> : null}
    </div>
  );
}
