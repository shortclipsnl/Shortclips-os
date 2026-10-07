import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <Logo size={34} />
      <div className="max-w-md text-center">
        <FileQuestion className="mx-auto size-10 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
        <h1 className="mt-4 text-lg font-semibold">Pagina niet gevonden</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Deze pagina bestaat niet, of je hebt er geen toegang toe.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 text-sm font-medium text-white hover:bg-[var(--color-indigo-soft)]"
        >
          Terug naar start
        </Link>
      </div>
    </div>
  );
}
