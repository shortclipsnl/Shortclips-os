"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, CornerDownRight, EyeOff, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createChapter,
  createLesson,
  deleteChapter,
  deleteLesson,
  moveLesson,
  moveTopLevel,
  renameChapter,
} from "@/server/actions/kennisbank";
import type { OutlineItem, OutlineLesson } from "@/server/kennisbank";
import { cn } from "@/lib/cn";

type Props = {
  courseId: string;
  outline: OutlineItem[];
  activeLessonId: string | null;
  manage: boolean;
};

export function CourseOutline({ courseId, outline, activeLessonId, manage }: Props) {
  const activeChapter = outline.find((o) => o.kind === "chapter" && o.lessons.some((l) => l.id === activeLessonId));
  // Het hoofdstuk van de geopende les staat uitgeklapt; de rest kan de
  // medewerker zelf uit- en inklappen.
  const activeChapterId = activeChapter && activeChapter.kind === "chapter" ? activeChapter.id : null;
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => toggled[id] ?? id === activeChapterId;
  const toggle = (id: string) => setToggled((cur) => ({ ...cur, [id]: !isOpen(id) }));

  const chapters = outline.filter((o): o is Extract<OutlineItem, { kind: "chapter" }> => o.kind === "chapter");

  return (
    <nav aria-label="Hoofdstukken en lessen" className="space-y-0.5">
      {outline.map((item, idx) =>
        item.kind === "chapter" ? (
          <div key={item.id}>
            <div className="group flex items-center gap-1 rounded-md hover:bg-[var(--color-surface-2)]">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-expanded={isOpen(item.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold text-[var(--color-ink)]"
              >
                <span className="min-w-0">{item.title}</span>
                {isOpen(item.id) ? <ChevronUp className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" /> : <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" />}
              </button>
              {manage ? <ChapterMenu courseId={courseId} chapterId={item.id} title={item.title} isFirst={idx === 0} isLast={idx === outline.length - 1} /> : null}
            </div>
            {isOpen(item.id) ? (
              <ul className="mb-1 space-y-0.5">
                {item.lessons.map((l, li) => (
                  <LessonRow key={l.id} courseId={courseId} lesson={l} active={l.id === activeLessonId} manage={manage} indent chapters={chapters} isFirst={li === 0} isLast={li === item.lessons.length - 1} />
                ))}
                {item.lessons.length === 0 ? <li className="px-6 py-1.5 text-xs text-[var(--color-ink-faint)]">Nog geen lessen</li> : null}
                {manage ? <AddLessonButton courseId={courseId} chapterId={item.id} /> : null}
              </ul>
            ) : null}
          </div>
        ) : (
          <ul key={item.lesson.id}>
            <LessonRow courseId={courseId} lesson={item.lesson} active={item.lesson.id === activeLessonId} manage={manage} chapters={chapters} isFirst={idx === 0} isLast={idx === outline.length - 1} />
          </ul>
        ),
      )}
      {manage ? <OutlineFooter courseId={courseId} /> : null}
    </nav>
  );
}

function LessonRow({
  courseId,
  lesson,
  active,
  manage,
  indent,
  chapters,
  isFirst,
  isLast,
}: {
  courseId: string;
  lesson: OutlineLesson;
  active: boolean;
  manage: boolean;
  indent?: boolean;
  chapters: Array<{ id: string; title: string }>;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <li className="group relative">
      <Link
        href={`/kennisbank/${courseId}?les=${lesson.id}`}
        scroll={false}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center justify-between gap-2 rounded-md py-2 pr-2 text-sm",
          indent ? "pl-6" : "pl-3",
          active ? "bg-[#fde9a8] font-medium text-[var(--color-indigo-ink)]" : "text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]",
          manage && "pr-9",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {!lesson.isPublished ? <EyeOff className="h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-label="Concept" /> : null}
          <span className="min-w-0">{lesson.title}</span>
        </span>
        {lesson.completed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1f9d55]" aria-label="Afgerond" /> : null}
      </Link>
      {manage ? (
        <div className="absolute right-1 top-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <LessonMenu lesson={lesson} chapters={chapters} isFirst={isFirst} isLast={isLast} courseId={courseId} />
        </div>
      ) : null}
    </li>
  );
}

function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; id?: string }>, after?: (id?: string) => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) window.alert(res.message ?? "Er ging iets mis.");
      else after?.(res.id);
      router.refresh();
    });
  return { pending, run, router };
}

function Dropdown({ children, label }: { children: (close: () => void) => React.ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" aria-label={label} onClick={() => setOpen((o) => !o)} className="rounded p-1 text-[var(--color-ink-muted)] opacity-70 hover:bg-[var(--color-surface)] hover:opacity-100">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 text-sm shadow-lg">{children(() => setOpen(false))}</div>
        </>
      ) : null}
    </div>
  );
}

function Item({ children, onClick, danger, icon }: { children: React.ReactNode; onClick: () => void; danger?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-surface-2)]", danger && "text-[var(--color-bad)]")}>
      {icon}
      {children}
    </button>
  );
}

function ChapterMenu({ courseId, chapterId, title, isFirst, isLast }: { courseId: string; chapterId: string; title: string; isFirst: boolean; isLast: boolean }) {
  const { run, router } = useRun();
  return (
    <Dropdown label="Hoofdstuk beheren">
      {(close) => (
        <>
          <Item icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { close(); const t = window.prompt("Titel van de nieuwe les"); if (t) run(() => createLesson(courseId, chapterId, t), (id) => id && router.push(`/kennisbank/${courseId}?les=${id}&bewerk=1`)); }}>Les toevoegen</Item>
          <Item icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { close(); const t = window.prompt("Naam van het hoofdstuk", title); if (t && t !== title) run(() => renameChapter(chapterId, t)); }}>Hernoemen</Item>
          {!isFirst ? <Item icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => { close(); run(() => moveTopLevel(courseId, chapterId, -1)); }}>Omhoog</Item> : null}
          {!isLast ? <Item icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => { close(); run(() => moveTopLevel(courseId, chapterId, 1)); }}>Omlaag</Item> : null}
          <Item danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); if (window.confirm(`Hoofdstuk "${title}" en de lessen daarin verwijderen?`)) run(() => deleteChapter(chapterId)); }}>Verwijderen</Item>
        </>
      )}
    </Dropdown>
  );
}

function LessonMenu({ courseId, lesson, chapters, isFirst, isLast }: { courseId: string; lesson: OutlineLesson; chapters: Array<{ id: string; title: string }>; isFirst: boolean; isLast: boolean }) {
  const { run, router } = useRun();
  const [moving, setMoving] = useState(false);
  return (
    <Dropdown label="Les beheren">
      {(close) =>
        moving ? (
          <div className="max-h-72 overflow-y-auto">
            <div className="px-3 py-1 text-xs font-semibold text-[var(--color-ink-muted)]">Verplaatsen naar</div>
            {chapters.filter((c) => c.id !== lesson.chapterId).map((c) => (
              <Item key={c.id} icon={<CornerDownRight className="h-3.5 w-3.5" />} onClick={() => { close(); setMoving(false); run(() => moveLesson(lesson.id, { toChapterId: c.id })); }}>{c.title}</Item>
            ))}
            {lesson.chapterId ? <Item onClick={() => { close(); setMoving(false); run(() => moveLesson(lesson.id, { toChapterId: null })); }}>Zonder hoofdstuk</Item> : null}
          </div>
        ) : (
          <>
            <Item icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { close(); router.push(`/kennisbank/${courseId}?les=${lesson.id}&bewerk=1`); }}>Bewerken</Item>
            {!isFirst ? <Item icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => { close(); run(() => moveLesson(lesson.id, { direction: -1 })); }}>Omhoog</Item> : null}
            {!isLast ? <Item icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => { close(); run(() => moveLesson(lesson.id, { direction: 1 })); }}>Omlaag</Item> : null}
            <Item icon={<CornerDownRight className="h-3.5 w-3.5" />} onClick={() => setMoving(true)}>Naar ander hoofdstuk…</Item>
            <Item danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); if (window.confirm(`Les "${lesson.title}" verwijderen?`)) run(() => deleteLesson(lesson.id), () => router.push(`/kennisbank/${courseId}`)); }}>Verwijderen</Item>
          </>
        )
      }
    </Dropdown>
  );
}

function AddLessonButton({ courseId, chapterId }: { courseId: string; chapterId: string }) {
  const { run, router, pending } = useRun();
  return (
    <li>
      <button
        type="button"
        disabled={pending}
        onClick={() => { const t = window.prompt("Titel van de nieuwe les"); if (t) run(() => createLesson(courseId, chapterId, t), (id) => id && router.push(`/kennisbank/${courseId}?les=${id}&bewerk=1`)); }}
        className="flex w-full items-center gap-1.5 rounded-md py-1.5 pl-6 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        <Plus className="h-3.5 w-3.5" /> Les toevoegen
      </button>
    </li>
  );
}

function OutlineFooter({ courseId }: { courseId: string }) {
  const { run, router, pending } = useRun();
  return (
    <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-line)] pt-3">
      <button type="button" disabled={pending} onClick={() => { const t = window.prompt("Naam van het nieuwe hoofdstuk"); if (t) run(() => createChapter(courseId, t)); }} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
        <Plus className="h-4 w-4" /> Hoofdstuk toevoegen
      </button>
      <button type="button" disabled={pending} onClick={() => { const t = window.prompt("Titel van de nieuwe les (zonder hoofdstuk)"); if (t) run(() => createLesson(courseId, null, t), (id) => id && router.push(`/kennisbank/${courseId}?les=${id}&bewerk=1`)); }} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
        <Plus className="h-4 w-4" /> Losse les toevoegen
      </button>
    </div>
  );
}
