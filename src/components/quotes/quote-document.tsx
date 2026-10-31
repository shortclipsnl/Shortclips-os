import { euro, lineTotal, type QuoteBlock, type QuoteContent, type QuoteLineInput } from "@/lib/quotes";
import type { CompanyInfo } from "@/server/quotes/company";

/**
 * Presentatie van één offerte — gebruikt door de publieke pagina, de PDF en de
 * interne preview, zodat alles identiek is. Puur presentational (geen hooks),
 * dus bruikbaar in een server component. De `@page`/print-CSS staat op de
 * pagina eromheen, niet hier.
 */

export type QuoteDocData = {
  number: string;
  title: string;
  status: string;
  recipientCompany: string | null;
  recipientContactName: string | null;
  createdAt: Date;
  content: QuoteContent;
  lines: QuoteLineInput[];
  amount: number;
  acceptedByName?: string | null;
  acceptedAt?: Date | null;
};

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function LineItemsTable({ lines, amount }: { lines: QuoteLineInput[]; amount: number }) {
  return (
    <table className="qd-table">
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Omschrijving</th>
          <th style={{ textAlign: "right" }}>Aantal</th>
          <th style={{ textAlign: "right" }}>Prijs</th>
          <th style={{ textAlign: "right" }}>Totaal</th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr><td colSpan={4} style={{ color: "#8a94a6", padding: "10px 8px" }}>Nog geen regels toegevoegd.</td></tr>
        ) : lines.map((l, i) => (
          <tr key={i}>
            <td>{l.description}</td>
            <td style={{ textAlign: "right" }}>{l.quantity}</td>
            <td style={{ textAlign: "right" }}>{euro(l.unitPrice)}</td>
            <td style={{ textAlign: "right" }}>{euro(lineTotal(l))}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Totaal (excl. btw)</td>
          <td style={{ textAlign: "right", fontWeight: 700 }}>{euro(amount)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function Block({ block, lines, amount }: { block: QuoteBlock; lines: QuoteLineInput[]; amount: number }) {
  switch (block.type) {
    case "heading":
      return <h2 className="qd-h2">{block.text}</h2>;
    case "paragraph":
      return <p className="qd-p" style={{ whiteSpace: "pre-wrap" }}>{block.text}</p>;
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img className="qd-img" src={block.url} alt={block.alt ?? ""} />;
    case "lineItems":
      return (
        <section className="qd-section">
          {block.title ? <h2 className="qd-h2">{block.title}</h2> : null}
          <LineItemsTable lines={lines} amount={amount} />
        </section>
      );
    case "terms":
      return (
        <section className="qd-section qd-terms">
          {block.title ? <h3 className="qd-h3">{block.title}</h3> : null}
          <p className="qd-small" style={{ whiteSpace: "pre-wrap" }}>{block.text}</p>
        </section>
      );
    default:
      return null;
  }
}

export function QuoteDocument({ company, quote, accent = "#00003b" }: { company: CompanyInfo; quote: QuoteDocData; accent?: string }) {
  const brand = quote.content.accent || accent;
  const signed = quote.status === "ondertekend";
  const accepted = quote.status === "geaccepteerd" || signed;
  return (
    <article className="qd" style={{ ["--qd-brand" as string]: brand }}>
      <header className="qd-header">
        <div className="qd-brandblock">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shortclips-logo-onlight.png" alt={company.name} className="qd-logo" />
        </div>
        <div className="qd-meta">
          <div className="qd-meta-title">Offerte</div>
          <div className="qd-meta-line">Nr. {quote.number}</div>
          <div className="qd-meta-line">{fmtDate(quote.createdAt)}</div>
        </div>
      </header>

      <div className="qd-parties">
        <div>
          <div className="qd-label">Voor</div>
          <div className="qd-strong">{quote.recipientCompany ?? "—"}</div>
          {quote.recipientContactName ? <div>t.a.v. {quote.recipientContactName}</div> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="qd-label">Van</div>
          <div className="qd-strong">{company.name}</div>
          {company.address ? <div>{company.address}</div> : null}
          {company.postalCity ? <div>{company.postalCity}</div> : null}
          {company.email ? <div>{company.email}</div> : null}
        </div>
      </div>

      <h1 className="qd-h1">{quote.title}</h1>
      {quote.content.intro ? <p className="qd-p" style={{ whiteSpace: "pre-wrap" }}>{quote.content.intro}</p> : null}

      {(quote.content.blocks ?? []).map((b, i) => <Block key={i} block={b} lines={quote.lines} amount={quote.amount} />)}

      {accepted ? (
        <div className="qd-stamp">
          {signed ? "Ondertekend" : "Geaccepteerd"}
          {quote.acceptedByName ? <span> · {quote.acceptedByName}</span> : null}
          {quote.acceptedAt ? <span> · {fmtDate(quote.acceptedAt)}</span> : null}
        </div>
      ) : null}

      <footer className="qd-footer">
        <span>{company.name}</span>
        {company.kvk ? <span>KvK {company.kvk}</span> : null}
        {company.btw ? <span>BTW {company.btw}</span> : null}
        {company.iban ? <span>IBAN {company.iban}</span> : null}
        {company.website ? <span>{company.website}</span> : null}
      </footer>
    </article>
  );
}

/** De stijl van het offertedocument + het A4-formaat voor de PDF. Als los
 *  `<style>`-blok zodat de pagina (publiek + print) 'm kan meenemen. */
export const QUOTE_DOCUMENT_CSS = `
  .qd { --qd-brand:#00003b; max-width: 800px; margin: 0 auto; background:#fff; color:#1a1d29;
        font-family: var(--font-poppins), system-ui, sans-serif; padding: 48px 56px; box-sizing:border-box; }
  .qd-header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; border-bottom:3px solid var(--qd-brand); padding-bottom:18px; }
  .qd-logo { height:40px; width:auto; }
  .qd-meta { text-align:right; }
  .qd-meta-title { font-size:20px; font-weight:700; color:var(--qd-brand); }
  .qd-meta-line { font-size:13px; color:#51607a; }
  .qd-parties { display:flex; justify-content:space-between; gap:24px; margin:28px 0; font-size:13px; color:#51607a; }
  .qd-label { text-transform:uppercase; letter-spacing:.06em; font-size:10px; color:#8a94a6; margin-bottom:4px; }
  .qd-strong { font-weight:700; color:#1a1d29; font-size:15px; }
  .qd-h1 { font-size:26px; font-weight:700; color:var(--qd-brand); margin:8px 0 14px; }
  .qd-h2 { font-size:17px; font-weight:700; margin:22px 0 8px; color:#1a1d29; }
  .qd-h3 { font-size:14px; font-weight:700; margin:14px 0 6px; }
  .qd-p { font-size:14px; line-height:1.6; margin:0 0 12px; }
  .qd-small { font-size:12px; line-height:1.55; color:#51607a; }
  .qd-img { max-width:100%; border-radius:8px; margin:12px 0; }
  .qd-section { margin:18px 0; }
  .qd-table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
  .qd-table th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#8a94a6; padding:8px; border-bottom:2px solid #e6e9f0; }
  .qd-table td { padding:10px 8px; border-bottom:1px solid #eef1f6; }
  .qd-table tfoot td { border-top:2px solid var(--qd-brand); border-bottom:none; padding-top:12px; font-size:15px; }
  .qd-terms { background:#f6f8fc; border-radius:10px; padding:14px 18px; }
  .qd-stamp { display:inline-block; margin-top:22px; border:2px solid var(--qd-brand); color:var(--qd-brand);
              font-weight:700; padding:8px 16px; border-radius:8px; transform:rotate(-2deg); }
  .qd-footer { display:flex; flex-wrap:wrap; gap:16px; margin-top:32px; padding-top:14px; border-top:1px solid #e6e9f0; font-size:11px; color:#8a94a6; }
  @page { size: A4; margin: 0; }
  @media print { html, body { background:#fff; } .no-print { display:none !important; } .qd { box-shadow:none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;
