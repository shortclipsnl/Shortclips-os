import type { ReactNode } from "react";
import type { PMDoc, PMMark, PMNode } from "@/lib/kennisbank-doc";

/**
 * Toont lesinhoud (ProseMirror-JSON) als HTML. Ondersteunt alle opmaak die in
 * de Skool-lessen voorkomt: koppen 1-4, alinea's, vet, cursief, code, links,
 * scheidingslijnen, opsommingen (genummerd en ongenummerd), citaten,
 * codeblokken, harde regeleinden en afbeeldingen.
 *
 * Onbekende node-types worden niet weggegooid maar met hun tekst getoond,
 * zodat er nooit stilzwijgend inhoud verdwijnt.
 */

function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (/^(https?:|mailto:|tel:|\/)/i.test(h)) return h;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(h)) return `https://${h}`;
  return null;
}

function applyMarks(text: ReactNode, marks: PMMark[] | undefined, key: string): ReactNode {
  let out = text;
  for (const [i, m] of (marks ?? []).entries()) {
    const k = `${key}-m${i}`;
    switch (m.type) {
      case "bold":
        out = <strong key={k} className="font-semibold">{out}</strong>;
        break;
      case "italic":
        out = <em key={k}>{out}</em>;
        break;
      case "underline":
        out = <u key={k}>{out}</u>;
        break;
      case "strike":
        out = <s key={k}>{out}</s>;
        break;
      case "code":
        out = <code key={k} className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[0.9em]">{out}</code>;
        break;
      case "videoTimestamp":
        out = <span key={k} className="font-medium text-[var(--color-brand-700)]">{out}</span>;
        break;
      case "link": {
        const href = safeHref(m.attrs?.href);
        if (!href) break;
        const external = !href.startsWith("/");
        out = (
          <a
            key={k}
            href={href}
            className="font-medium text-[var(--color-brand-700)] underline underline-offset-2 hover:text-[var(--color-brand-600)]"
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {out}
          </a>
        );
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderChildren(n: PMNode, key: string): ReactNode[] {
  return (n.content ?? []).map((c, i) => renderNode(c, `${key}.${i}`));
}

function renderNode(n: PMNode, key: string): ReactNode {
  switch (n.type) {
    case "text":
      return applyMarks(n.text ?? "", n.marks, key);
    case "hardBreak":
      return <br key={key} />;
    case "paragraph":
      return (
        <p key={key} className="my-3 leading-relaxed">
          {n.content?.length ? renderChildren(n, key) : <>&nbsp;</>}
        </p>
      );
    case "heading": {
      const level = Math.min(4, Math.max(1, Number(n.attrs?.level ?? 2)));
      const cls = {
        1: "mt-7 mb-3 text-2xl font-bold",
        2: "mt-6 mb-2.5 text-xl font-bold",
        3: "mt-5 mb-2 text-lg font-semibold",
        4: "mt-4 mb-2 text-base font-semibold",
      }[level];
      const Tag = `h${level}` as "h1";
      return (
        <Tag key={key} className={`${cls} tracking-tight text-[var(--color-ink)]`}>
          {renderChildren(n, key)}
        </Tag>
      );
    }
    case "horizontalRule":
      return <hr key={key} className="my-6 border-t border-[var(--color-line-strong)]" />;
    case "unorderedList":
    case "bulletList":
      return (
        <ul key={key} className="my-3 list-disc space-y-1 pl-6 marker:text-[var(--color-ink-muted)]">
          {renderChildren(n, key)}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} start={Number(n.attrs?.start ?? 1)} className="my-3 list-decimal space-y-1 pl-6 marker:text-[var(--color-ink-muted)]">
          {renderChildren(n, key)}
        </ol>
      );
    case "listItem":
      return (
        <li key={key} className="pl-1 [&>p]:my-1">
          {renderChildren(n, key)}
        </li>
      );
    case "blockquote":
      return (
        <blockquote key={key} className="my-4 border-l-4 border-[var(--color-brand-300)] bg-[var(--color-surface-sunken)] py-1 pl-4 pr-3 text-[var(--color-ink)]">
          {renderChildren(n, key)}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre key={key} className="my-4 overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-[13px] leading-relaxed text-[var(--color-ink)]">
          <code>{renderChildren(n, key)}</code>
        </pre>
      );
    case "image": {
      const src = typeof n.attrs?.src === "string" ? n.attrs.src : null;
      if (!src) return null;
      const alt = typeof n.attrs?.alt === "string" ? n.attrs.alt : "";
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={key} src={src} alt={alt} loading="lazy" className="my-4 h-auto max-w-full rounded-lg border border-[var(--color-line)]" />
      );
    }
    default:
      // Onbekend type: inhoud toch tonen.
      return n.content?.length ? <div key={key}>{renderChildren(n, key)}</div> : n.text ? <span key={key}>{n.text}</span> : null;
  }
}

export function DocRenderer({ doc }: { doc: PMDoc }) {
  return <div className="kb-doc text-[15px] text-[var(--color-ink)]">{(doc.content ?? []).map((n, i) => renderNode(n, String(i)))}</div>;
}
