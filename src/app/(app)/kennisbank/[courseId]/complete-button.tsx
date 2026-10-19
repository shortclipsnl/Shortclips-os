"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { setLessonCompleted } from "@/server/actions/kennisbank";

export function CompleteButton({ lessonId, completed }: { lessonId: string; completed: boolean }) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(completed);
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          const res = await setLessonCompleted(lessonId, !optimistic);
          if (!res.ok) window.alert(res.message ?? "Opslaan mislukt.");
          router.refresh();
        })
      }
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        optimistic ? "bg-[#e3f4ea] text-[#17803f]" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:border-[#1f9d55] hover:text-[#17803f]"
      }`}
      aria-pressed={optimistic}
      title={optimistic ? "Markeer als niet afgerond" : "Markeer als afgerond"}
    >
      {optimistic ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      {optimistic ? "Afgerond" : "Markeer als afgerond"}
    </button>
  );
}
