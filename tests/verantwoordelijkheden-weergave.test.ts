import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VERANTWOORDELIJKEN, standaardConfig } from "@/lib/verantwoordelijkheden/data";
import { rolVoor } from "@/lib/verantwoordelijkheden/rol";
import type { LiveStand } from "@/server/verantwoordelijkheden-live";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => createElement("a", { href, className }, children),
}));

import { Weergave } from "@/app/(app)/verantwoordelijkheden/weergave";

const live: LiveStand = {
  kpis: {
    scripts: { id: "scripts", waarde: "1/2", toelichting: "1 opname binnen 7 werkdagen zonder definitief script", kleur: "oranje", href: "/scripting" },
    klantvragen: { id: "klantvragen", waarde: null, toelichting: "Nog geen meting", kleur: null, href: null },
    draaiboeken: { id: "draaiboeken", waarde: "2/5", toelichting: "3 opnames binnen 7 werkdagen zonder definitief script", kleur: "rood", href: "/scripting" },
  },
  klanten: [{ slug: "testklant", name: "Testklant", logoUrl: null, color: "#00003b", quota: 6, volgendeOpname: null, signalen: 2 }],
  opnames: [{ id: "abc", titel: "Opname", klant: "Testklant", logoUrl: null, color: null, datum: "2026-11-17", tijd: "09:00", scriptKlaar: false }],
  signalen: [{ key: "s1", klant: "Testklant", logoUrl: null, color: null, wat: "Feedbacktermijn verstreken", actie: "Klant herinneren", wanneer: "Vandaag", urgent: true, href: "/videos" }],
  signalenTotaal: 8,
  signalenBeschikbaar: true,
};

describe("Mijn verantwoordelijkheden: weergave per medewerker", () => {
  const config = standaardConfig();
  for (const m of VERANTWOORDELIJKEN) {
    it(`toont de pagina voor ${m.naam} zonder fouten`, () => {
      const rol = rolVoor(m.email)!;
      const html = renderToStaticMarkup(
        createElement(Weergave, { config, email: m.email, naam: m.naam, functie: m.functie, rol, live, markeer: false }),
      );
      expect(html).toContain(`Ik, ${m.naam}, ben verantwoordelijk voor`);
      expect(html).toContain("Zelf signaleren deze week");
      expect(html).toContain("Zelf oplossen en vastleggen");
      expect(html).toContain("Naar Jarno");
      expect(html).toContain(rol.key === "cc" ? "Mijn klanten" : "Mijn opnamedagen");
      // Het team ziet geen voorstelmarkeringen en geen beheerdersblok.
      expect(html).not.toContain("alleen zichtbaar voor jou");
      expect(html).not.toContain("[[");
      // Geen gegevens van andere functies.
      if (rol.key === "videograaf") expect(html).not.toContain("Maandrapportages te laat");
      else expect(html).not.toContain("Heropnames door technische fouten");
    });
  }

  it("toont Jarno het voorstel voor grenswaarden", () => {
    const m = VERANTWOORDELIJKEN[0];
    const html = renderToStaticMarkup(
      createElement(Weergave, { config, email: m.email, naam: m.naam, functie: m.functie, rol: rolVoor(m.email)!, live, markeer: true }),
    );
    expect(html).toContain("alleen zichtbaar voor jou");
  });
});
