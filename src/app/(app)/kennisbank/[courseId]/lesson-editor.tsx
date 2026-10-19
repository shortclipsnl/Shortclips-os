"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Trash2,
  Undo2,
  Paperclip,
  Link2,
} from "lucide-react";
import { saveLesson } from "@/server/actions/kennisbank";
import { toEditorDoc, type PMDoc } from "@/lib/kennisbank-doc";
import type { KbResource } from "@/db/schema";
import { uploadKbFile } from "@/components/kennisbank/upload";
import { cn } from "@/lib/cn";
import "./kb-editor.css";

export type LessonEditorProps = {
  courseId: string;
  lesson: {
    id: string;
    title: string;
    content: PMDoc;
    videoUrl: string | null;
    resources: KbResource[];
    isPublished: boolean;
  };
};

export function LessonEditor({ courseId, lesson }: LessonEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(lesson.title);
  const [videoUrl, setVideoUrl] = useState(lesson.videoUrl ?? "");
  const [resources, setResources] = useState<KbResource[]>(lesson.resources);
  const [isPublished, setIsPublished] = useState(lesson.isPublished);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => toEditorDoc(lesson.content), [lesson.content]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: initial,
    editorProps: {
      attributes: { class: "kb-editor min-h-[420px] px-5 py-4 text-[15px] leading-relaxed focus:outline-none" },
    },
    onUpdate: () => setDirty(true),
  });

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mark = () => setDirty(true);

  async function upload(file: File, label: string) {
    setUploading(`${label}: 0%`);
    try {
      return await uploadKbFile(file, (p) => setUploading(`${label}: ${p}%`));
    } finally {
      setUploading(null);
    }
  }

  async function onImage(file: File | undefined) {
    if (!file || !editor) return;
    try {
      const a = await upload(file, "Afbeelding uploaden");
      editor.chain().focus().setImage({ src: a.url, alt: file.name }).run();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function onAttachment(file: File | undefined) {
    if (!file) return;
    try {
      const a = await upload(file, "Bijlage uploaden");
      setResources((r) => [...r, { title: file.name.replace(/\.[^.]+$/, ""), assetId: a.id, fileName: file.name, contentType: a.contentType, url: null }]);
      mark();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function save() {
    if (!editor) return;
    setBusy(true);
    setMsg(null);
    const res = await saveLesson(lesson.id, {
      title,
      content: editor.getJSON() as PMDoc,
      videoUrl: videoUrl.trim() || null,
      resources,
      isPublished,
    });
    setBusy(false);
    if (res.ok) {
      setDirty(false);
      setMsg({ ok: true, text: res.message ?? "Opgeslagen." });
      router.push(`/kennisbank/${courseId}?les=${lesson.id}`);
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.message ?? "Opslaan mislukt. Je wijzigingen staan nog in de editor." });
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="space-y-3 border-b border-[var(--color-line)] p-5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Titel van de les
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); mark(); }}
            className="mt-1 w-full text-lg font-semibold normal-case tracking-normal"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Video (Loom-, YouTube- of Vimeo-link, optioneel)
          <input
            value={videoUrl}
            onChange={(e) => { setVideoUrl(e.target.value); mark(); }}
            placeholder="https://www.loom.com/share/…"
            className="mt-1 w-full text-sm font-normal normal-case tracking-normal"
          />
        </label>
      </div>

      {editor ? <Toolbar editor={editor} onImage={() => imgInput.current?.click()} /> : <div className="h-11 border-b border-[var(--color-line)]" />}
      <input ref={imgInput} type="file" accept="image/*" className="hidden" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ""; }} />
      <EditorContent editor={editor} />

      <div className="border-t border-[var(--color-line)] p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Bijlagen</h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-2)]">
              <Paperclip className="h-3.5 w-3.5" /> Document uploaden
            </button>
            <button
              type="button"
              onClick={() => {
                const url = window.prompt("Link (bijv. Google Drive)");
                if (!url) return;
                const t = window.prompt("Naam van de link", url) ?? url;
                setResources((r) => [...r, { title: t, url, assetId: null }]);
                mark();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-2)]"
            >
              <Link2 className="h-3.5 w-3.5" /> Link toevoegen
            </button>
          </div>
          <input ref={fileInput} type="file" className="hidden" onChange={(e) => { onAttachment(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {resources.length === 0 ? <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Geen bijlagen.</p> : null}
        <ul className="mt-2 space-y-1.5">
          {resources.map((r, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2 py-1.5">
              {r.assetId ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" /> : <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" />}
              <input
                value={r.title}
                onChange={(e) => { const t = e.target.value; setResources((rs) => rs.map((x, j) => (j === i ? { ...x, title: t } : x))); mark(); }}
                className="min-w-0 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm shadow-none"
                aria-label="Naam van de bijlage"
              />
              <span className="hidden truncate text-xs text-[var(--color-ink-faint)] sm:block sm:max-w-[200px]">{r.fileName ?? r.url}</span>
              <button type="button" disabled={i === 0} onClick={() => { setResources((rs) => { const n = [...rs]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; }); mark(); }} className="rounded p-1 hover:bg-[var(--color-surface-2)] disabled:opacity-30" aria-label="Omhoog"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" disabled={i === resources.length - 1} onClick={() => { setResources((rs) => { const n = [...rs]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; }); mark(); }} className="rounded p-1 hover:bg-[var(--color-surface-2)] disabled:opacity-30" aria-label="Omlaag"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => { setResources((rs) => rs.filter((_, j) => j !== i)); mark(); }} className="rounded p-1 text-[var(--color-bad)] hover:bg-[var(--color-surface-2)]" aria-label="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPublished} onChange={(e) => { setIsPublished(e.target.checked); mark(); }} />
          Gepubliceerd (zichtbaar voor het team)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {uploading ? <span className="text-xs text-[var(--color-ink-muted)]">{uploading}</span> : null}
          {msg ? <span className={cn("text-sm", msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]")}>{msg.text}</span> : null}
          <button
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Wijzigingen niet opslaan?")) return;
              router.push(`/kennisbank/${courseId}?les=${lesson.id}`);
            }}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            Annuleren
          </button>
          <button type="button" onClick={save} disabled={busy || !!uploading || !editor} className="rounded-md bg-[var(--color-indigo-ink)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Opslaan…" : isPublished ? "Opslaan en publiceren" : "Opslaan als concept"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && !e.isDestroyed
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            link: e.isActive("link"),
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            h4: e.isActive("heading", { level: 4 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            code: e.isActive("codeBlock"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });
  if (!state) return <div className="h-11 border-b border-[var(--color-line)]" />;
  const c = () => editor.chain().focus();
  const sep = <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />;
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5">
      <B label="Normale tekst" on={() => c().setParagraph().run()}><Pilcrow className="h-4 w-4" /></B>
      <B label="Kop 1" active={state.h1} on={() => c().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></B>
      <B label="Kop 2" active={state.h2} on={() => c().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></B>
      <B label="Kop 3" active={state.h3} on={() => c().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></B>
      <B label="Kop 4" active={state.h4} on={() => c().toggleHeading({ level: 4 }).run()}><Heading4 className="h-4 w-4" /></B>
      {sep}
      <B label="Vet" active={state.bold} on={() => c().toggleBold().run()}><Bold className="h-4 w-4" /></B>
      <B label="Cursief" active={state.italic} on={() => c().toggleItalic().run()}><Italic className="h-4 w-4" /></B>
      <B
        label="Link"
        active={state.link}
        on={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link (leeg = link weghalen)", prev ?? "https://");
          if (url === null) return;
          if (url.trim() === "") c().extendMarkRange("link").unsetLink().run();
          else c().extendMarkRange("link").setLink({ href: url.trim() }).run();
        }}
      >
        <LinkIcon className="h-4 w-4" />
      </B>
      {sep}
      <B label="Opsomming" active={state.bullet} on={() => c().toggleBulletList().run()}><List className="h-4 w-4" /></B>
      <B label="Genummerde lijst" active={state.ordered} on={() => c().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></B>
      <B label="Citaat" active={state.quote} on={() => c().toggleBlockquote().run()}><Quote className="h-4 w-4" /></B>
      <B label="Codeblok" active={state.code} on={() => c().toggleCodeBlock().run()}><Code className="h-4 w-4" /></B>
      <B label="Scheidingslijn" on={() => c().setHorizontalRule().run()}><Minus className="h-4 w-4" /></B>
      <B label="Afbeelding uploaden" on={onImage}><ImagePlus className="h-4 w-4" /></B>
      {sep}
      <B label="Ongedaan maken" disabled={!state.canUndo} on={() => c().undo().run()}><Undo2 className="h-4 w-4" /></B>
      <B label="Opnieuw" disabled={!state.canRedo} on={() => c().redo().run()}><Redo2 className="h-4 w-4" /></B>
    </div>
  );
}

function B({ on, active, label, children, disabled }: { on: () => void; active?: boolean; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn("rounded p-1.5 hover:bg-[var(--color-surface-2)] disabled:opacity-30", active && "bg-[var(--color-brand-100)] text-[var(--color-indigo-ink)]")}
    >
      {children}
    </button>
  );
}
