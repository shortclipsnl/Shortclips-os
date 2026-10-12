"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { EditorOption } from "./editable-cells";

/** Filter het Editing Dashboard op editor (medewerker). Behoudt de overige
 *  filters in de URL. */
export function EditorFilter({ editors, current }: { editors: EditorOption[]; current?: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(value: string) {
    const qs = new URLSearchParams(params.toString());
    if (value) qs.set("editor", value);
    else qs.delete("editor");
    router.push(`/videos?${qs.toString()}`);
  }

  return (
    <select
      className="sc-input h-8 w-auto py-0 text-xs"
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter op editor"
    >
      <option value="">Alle editors</option>
      {editors.map((ed) => (
        <option key={ed.id} value={ed.id}>{ed.fullName}</option>
      ))}
    </select>
  );
}
