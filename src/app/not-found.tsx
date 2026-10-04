import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <FileQuestion className="mx-auto size-10 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
        <h1 className="mt-4 text-lg font-semibold">Niet gevonden</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Deze pagina bestaat niet, of je hebt er geen toegang toe.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 text-sm font-medium text-white hover:bg-[var(--color-indigo-soft)]"
        >
          Naar het dashboard
        </Link>
      </div>
    </div>
  );
}
