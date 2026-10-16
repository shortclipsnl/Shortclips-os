import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { salesLeads, users } from "@/db/schema";
import { env } from "@/lib/env";
import { dispatch } from "@/server/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lead-intake vanaf een extern formulier (Meta-advertentie "Shortclips
 * kennismaking" of een Framer-formulier). Vervangt de Monday-automatisering die
 * leads uit de advertentie in het leadsbord zette.
 *
 * Beveiliging: het formulier stuurt een gedeeld geheim mee (header
 * `x-webhook-secret` of `?secret=`), vergeleken met LEADS_WEBHOOK_SECRET. Zonder
 * dat geheim is het endpoint dicht. Het endpoint schrijft alléén een lead weg —
 * het leest of wijzigt niets anders.
 */

function authorized(request: Request): boolean {
  const secret = env.LEADS_WEBHOOK_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const provided = request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Eerste niet-lege waarde uit een reeks mogelijke veldnamen. */
function pick(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

export async function POST(request: Request) {
  if (!env.LEADS_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Niet geconfigureerd. Zet LEADS_WEBHOOK_SECRET in de omgeving." },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Niet toegestaan." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = (await request.json()) as Record<string, unknown>;
    } else {
      // Framer/HTML-formulieren posten vaak form-encoded.
      const form = await request.formData();
      body = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    }
  } catch {
    return NextResponse.json({ error: "Onleesbare body." }, { status: 400 });
  }

  const name = pick(body, ["full_name", "fullName", "name", "naam", "voornaam"]);
  const company = pick(body, ["company", "company_name", "bedrijf", "bedrijfsnaam"]) ?? name;
  const email = pick(body, ["email", "e-mail", "emailadres", "email_address"]);
  const phone = pick(body, ["phone", "phone_number", "telefoon", "telefoonnummer", "tel"]);
  const source = pick(body, ["source", "bron"]) ?? "Meta advertentie";
  const note = pick(body, ["message", "bericht", "lead_info", "vraag"]);

  if (!company && !email && !phone) {
    return NextResponse.json({ error: "Geen bruikbare leadgegevens ontvangen." }, { status: 400 });
  }

  const finalCompany = (company ?? name ?? "Onbekende lead").slice(0, 200);
  const contactName = name && name.toLowerCase() !== finalCompany.toLowerCase() ? name.slice(0, 160) : null;

  // Lichte dedupe: zelfde e-mail als lead in de afgelopen 24 uur → niet dubbel.
  if (email) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [dup] = await db
      .select({ id: salesLeads.id })
      .from(salesLeads)
      .where(and(eq(salesLeads.email, email), isNull(salesLeads.deletedAt), gte(salesLeads.createdAt, dayAgo)))
      .limit(1);
    if (dup) return NextResponse.json({ ok: true, deduped: true, id: dup.id });
  }

  // Verantwoordelijke voor nieuwe leads = de eigenaar.
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)))
    .limit(1);
  const ownerId = owner?.id ?? null;

  const [created] = await db
    .insert(salesLeads)
    .values({
      company: finalCompany,
      contactName,
      email: email?.slice(0, 160) ?? null,
      phone: phone?.slice(0, 40) ?? null,
      source: source.slice(0, 40),
      status: "lead",
      segment: String(new Date().getFullYear()),
      note: note?.slice(0, 2000) ?? "Automatisch binnengekomen via het aanmeldformulier.",
      firstContactOn: new Date().toISOString().slice(0, 10),
      // Leads zijn eigenaar-werk: een nieuwe lead krijgt direct een
      // verantwoordelijke (de eigenaar) i.p.v. ongekoppeld binnen te komen.
      ownerId: ownerId ?? null,
    })
    .returning({ id: salesLeads.id });

  await dispatch({
    trigger: "lead.created",
    entityType: "sales_lead",
    entityId: created!.id,
    data: { to: "lead", href: "/leads" },
  });

  return NextResponse.json({ ok: true, id: created!.id });
}
