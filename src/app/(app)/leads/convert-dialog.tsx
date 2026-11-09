"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightCircle, Check, Loader2, X } from "lucide-react";
import { convertLeadWithOnboarding, loadConvertForm } from "@/server/actions/onboarding";
import type { ConvertForm } from "@/server/onboarding";
import { PAKKETTEN } from "@/lib/onboarding-plan";
import { Button } from "@/components/ui";

type Pakket = (typeof PAKKETTEN)[number]["value"];

/** Knop "Omzetten naar klant" plus het controlevenster. */
export function ConvertButton({ leadId, label = "Naar klant" }: { leadId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-surface-sunken)]"
        title="Zet deze lead om naar een klant: controleer de gegevens, daarna richt het portaal de klant in"
      >
        <ArrowRightCircle className="size-3.5" /> {label}
      </button>
      {open ? <ConvertDialog leadId={leadId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ConvertDialog({ leadId, onClose: close }: { leadId: string; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<ConvertForm | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{ slug: string; name: string }[] | null>(null);
  const [done, setDone] = useState<{ slug: string; driveOk: boolean; driveMsg?: string; tasks: number } | null>(null);

  // Velden
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pakket, setPakket] = useState<Pakket>("org8");
  const [monthly, setMonthly] = useState("");
  const [startOn, setStartOn] = useState("");
  const [months, setMonths] = useState("3");
  const [pmId, setPmId] = useState("");
  const [publisher, setPublisher] = useState<"shortclips" | "klant">("shortclips");
  const [notes, setNotes] = useState("");

  // Na omzetten pas bij sluiten de lijst verversen (anders verdwijnt dit venster).
  const onClose = () => {
    if (done) router.refresh();
    close();
  };

  useEffect(() => {
    let alive = true;
    loadConvertForm(leadId).then((r) => {
      if (!alive) return;
      if (!r.ok) return setLoadErr(r.message);
      const f = r.form;
      setForm(f);
      setCompany(f.lead.company);
      setContactName(f.lead.contactName ?? "");
      setEmail(f.lead.email ?? "");
      setPhone(f.lead.phone ?? "");
      setMonthly(f.lead.expectedMonthly ? String(Math.round(Number(f.lead.expectedMonthly))) : "");
      setStartOn(f.lead.startOn ?? "");
      setPmId(f.defaultPmId ?? "");
    });
    return () => {
      alive = false;
    };
  }, [leadId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const pk = PAKKETTEN.find((p) => p.value === pakket)!;
  const pmName = form?.pms.find((p) => p.id === pmId)?.name ?? "";

  function submit(opts: { confirmSimilar?: boolean; linkToClientId?: string | null } = {}) {
    setErr(null);
    start(async () => {
      const res = await convertLeadWithOnboarding({
        leadId,
        company,
        contactName: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        pakket,
        shortsPerMonth: pk.shorts,
        contentFocus: pk.focus,
        monthlyRevenue: monthly.trim() || null,
        startOn: startOn || null,
        contractMonths: months ? Number(months) : null,
        coordinatorId: pmId,
        publisher,
        notes: notes.trim() || null,
        confirmSimilar: Boolean(opts.confirmSimilar),
        linkToClientId: opts.linkToClientId ?? null,
      });
      if (res.ok) {
        // Direct door naar de onboarding van de klant: daar staat wat er is gebeurd.
        setDone({ slug: res.slug, driveOk: res.drive.ok, driveMsg: res.drive.message, tasks: res.tasks });
        router.push(`/clients/${res.slug}?tab=onboarding`);
      } else if (res.similar?.length) {
        setSimilar(res.similar);
      } else {
        setErr(res.message);
      }
    });
  }

  const field = "sc-input h-9 w-full text-sm";
  const lbl = "mb-1 block text-xs font-medium text-[var(--color-ink-muted)]";
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium ${on ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white" : "border-[var(--color-line-strong)] text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4 text-left text-[var(--color-ink)]" onClick={() => !pending && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Omzetten naar klant"
        className="my-6 w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h3 className="text-base font-bold">Omzetten naar klant</h3>
            <p className="text-xs text-[var(--color-ink-muted)]">Controleer de gegevens. Wat bij de lead bekend is, staat al ingevuld.</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Sluiten" className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
            <X className="size-4" />
          </button>
        </div>

        {loadErr ? <p className="px-5 py-6 text-sm text-[var(--color-bad)]">{loadErr}</p> : null}
        {!form && !loadErr ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-[var(--color-ink-muted)]"><Loader2 className="size-4 animate-spin" /> Gegevens ophalen…</p>
        ) : null}

        {form && form.alreadyClient && !done ? (
          <div className="px-5 py-6 text-sm">
            Deze lead is al omgezet naar <a className="font-semibold text-[var(--color-brand-700)] hover:underline" href={`/clients/${form.alreadyClient.slug}?tab=onboarding`}>{form.alreadyClient.name}</a>. Er wordt niets dubbel aangemaakt.
          </div>
        ) : null}

        {done ? (
          <div className="space-y-3 px-5 py-5 text-sm">
            <p className="text-base font-semibold">{company} staat klaar bij {pmName}</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2"><Check className="size-4 text-[var(--color-good)]" /> Klant aangemaakt, lead op Gewonnen en gekoppeld</li>
              <li className="flex items-center gap-2"><Check className="size-4 text-[var(--color-good)]" /> Contract en contactpersoon ingevuld</li>
              <li className="flex items-center gap-2">
                {done.driveOk ? <Check className="size-4 text-[var(--color-good)]" /> : <AlertTriangle className="size-4 text-[var(--color-warn)]" />}
                {done.driveOk ? "Google Drive-map met de standaardmappen" : `Drive-map mislukt: ${done.driveMsg ?? "probeer opnieuw op de klantpagina"}`}
              </li>
              <li className="flex items-center gap-2"><Check className="size-4 text-[var(--color-good)]" /> {done.tasks} taken en één melding voor {pmName}</li>
              <li className="flex items-center gap-2"><Check className="size-4 text-[var(--color-good)]" /> Welkomstbericht als concept, welkomstbestand gekoppeld</li>
            </ul>
            <p className="text-xs text-[var(--color-ink-muted)]">Er is niets naar de klant verstuurd.</p>
            <div className="flex justify-end">
              <a href={`/clients/${done.slug}?tab=onboarding`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-500)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90">
                Naar de onboarding
              </a>
            </div>
          </div>
        ) : null}

        {form && !form.alreadyClient && !done ? (
          <>
            <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
              <div>
                <label className={lbl} htmlFor="cv-company">Bedrijfsnaam</label>
                <input id="cv-company" className={field} value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div>
                <label className={lbl} htmlFor="cv-contact">Contactpersoon</label>
                <input id="cv-contact" className={field} value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div>
                <label className={lbl} htmlFor="cv-email">E-mailadres</label>
                <input id="cv-email" type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className={lbl} htmlFor="cv-phone">Telefoonnummer</label>
                <input id="cv-phone" className={field} value={phone} placeholder="Nodig voor de WhatsAppgroep" onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <span className={lbl}>Pakket</span>
                <div className="flex flex-wrap gap-2">
                  {PAKKETTEN.map((p) => (
                    <button key={p.value} type="button" className={chip(pakket === p.value)} onClick={() => setPakket(p.value)}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl} htmlFor="cv-monthly">Maandbedrag excl. btw (€)</label>
                <input id="cv-monthly" inputMode="decimal" className={field} value={monthly} placeholder="Uit de offerte" onChange={(e) => setMonthly(e.target.value)} />
              </div>
              <div>
                <label className={lbl} htmlFor="cv-start">Startdatum samenwerking</label>
                <input id="cv-start" type="date" className={field} value={startOn} onChange={(e) => setStartOn(e.target.value)} />
              </div>
              <div>
                <label className={lbl} htmlFor="cv-months">Contractduur</label>
                <select id="cv-months" className={field} value={months} onChange={(e) => setMonths(e.target.value)}>
                  <option value="3">3 maanden</option>
                  <option value="6">6 maanden</option>
                  <option value="12">12 maanden</option>
                  <option value="">Onbepaald</option>
                </select>
              </div>
              <div>
                <span className={lbl}>Projectmanager</span>
                <div className="flex flex-wrap gap-2">
                  {form.pms.map((p) => (
                    <button key={p.id} type="button" className={chip(pmId === p.id)} onClick={() => setPmId(p.id)}>{p.name.split(" ")[0]}</button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <span className={lbl}>Wie publiceert de content?</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={chip(publisher === "shortclips")} onClick={() => setPublisher("shortclips")}>Shortclips</button>
                  <button type="button" className={chip(publisher === "klant")} onClick={() => setPublisher("klant")}>De klant zelf</button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={lbl} htmlFor="cv-notes">Bijzonderheden en afspraken</label>
                <textarea id="cv-notes" rows={2} className="sc-input w-full resize-y py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            <div className="mx-5 space-y-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-3 text-xs">
              <p className="font-semibold">Controles</p>
              <p className="flex items-center gap-1.5 text-[var(--color-good)]"><Check className="size-3.5" /> Lead is nog niet eerder omgezet</p>
              {form.similarClients.length === 0 ? (
                <p className="flex items-center gap-1.5 text-[var(--color-good)]"><Check className="size-3.5" /> Geen bestaande klant met een gelijkende naam</p>
              ) : (
                <p className="flex items-start gap-1.5 text-[var(--color-warn)]"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Lijkt op bestaande klant: {form.similarClients.map((c) => c.name).join(", ")}</p>
              )}
              {!phone.trim() ? (
                <p className="flex items-start gap-1.5 text-[var(--color-warn)]"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Telefoonnummer ontbreekt. Omzetten kan; de WhatsApp-taak wacht dan op het nummer.</p>
              ) : null}
              {!monthly.trim() ? (
                <p className="flex items-start gap-1.5 text-[var(--color-warn)]"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Maandbedrag ontbreekt. Vul het later aan bij Contract &amp; facturatie.</p>
              ) : null}
            </div>

            {similar ? (
              <div className="mx-5 mt-3 rounded-[var(--radius-md)] border border-[var(--color-warn)] px-4 py-3 text-xs">
                <p className="mb-2 font-semibold">Er bestaat al een klant met een gelijkende naam. Wat wil je doen?</p>
                <div className="flex flex-wrap gap-2">
                  {form.similarClients.map((c) => (
                    <button key={c.id} type="button" disabled={pending} className={chip(false)} onClick={() => submit({ linkToClientId: c.id })}>
                      Koppel aan {c.name}
                    </button>
                  ))}
                  <button type="button" disabled={pending} className={chip(false)} onClick={() => submit({ confirmSimilar: true })}>
                    Toch nieuwe klant aanmaken
                  </button>
                </div>
              </div>
            ) : null}

            {err ? <p className="mx-5 mt-3 text-xs font-medium text-[var(--color-bad)]">{err}</p> : null}

            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <span className="text-2xs text-[var(--color-ink-muted)]">Na bevestigen: klant, Drive-map, taken en welkomstconcept. Er gaat niets naar de klant.</span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Annuleren</Button>
                <Button type="button" disabled={pending || !company.trim() || !pmId} onClick={() => submit({ confirmSimilar: false })}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null} Bevestigen en klant aanmaken
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
