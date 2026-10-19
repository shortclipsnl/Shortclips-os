"use client";

import dynamic from "next/dynamic";
import type { LessonEditorProps } from "./lesson-editor";

const LessonEditor = dynamic(() => import("./lesson-editor").then((m) => m.LessonEditor), {
  ssr: false,
  loading: () => <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-ink-muted)]">Editor laden…</div>,
});

export function LessonEditorLoader(props: LessonEditorProps) {
  return <LessonEditor {...props} />;
}
