import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  ALL_PERMISSIONS,
  ROLE_DEFINITIONS,
  permissionsForRole,
} from "@/server/auth/permissions";

describe("wachtwoorden", () => {
  it("slaat nooit het wachtwoord zelf op", async () => {
    const hash = await hashPassword("geheim-wachtwoord-123");
    expect(hash).not.toContain("geheim-wachtwoord-123");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("geeft bij elke aanroep een andere hash (eigen salt)", async () => {
    const a = await hashPassword("zelfde");
    const b = await hashPassword("zelfde");
    expect(a).not.toBe(b);
  });

  it("accepteert het juiste wachtwoord en weigert het verkeerde", async () => {
    const hash = await hashPassword("Correct-Paard-Batterij");
    expect(await verifyPassword("Correct-Paard-Batterij", hash)).toBe(true);
    expect(await verifyPassword("correct-paard-batterij", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("weigert wanneer er geen hash is opgeslagen", async () => {
    expect(await verifyPassword("iets", null)).toBe(false);
    expect(await verifyPassword("iets", "onzin")).toBe(false);
  });
});

describe("rollen en rechten", () => {
  it("geeft de eigenaar alle rechten", () => {
    expect(permissionsForRole("owner")).toEqual(ALL_PERMISSIONS);
  });

  it("houdt financiële informatie weg bij editors", () => {
    const perms = permissionsForRole("editor");
    expect(perms).not.toContain("finance:read");
    expect(perms).not.toContain("finance:read_costs");
    expect(perms).not.toContain("clients:read_all");
    expect(perms).toContain("videos:read");
  });

  it("geeft een klantrol uitsluitend portaalrechten", () => {
    const perms = permissionsForRole("client");
    expect(perms).toEqual(["portal:access", "portal:approve"]);
    for (const p of perms) expect(p.startsWith("portal:")).toBe(true);
  });

  it("geeft finance-rechten uitsluitend aan de eigenaar", () => {
    // Finance (omzet, kosten, marges) is bewust owner-only. Geen enkele andere
    // rol — ook de Finance-rapportagerol niet — mag finance:read/write krijgen.
    for (const role of ROLE_DEFINITIONS) {
      if (role.key === "owner") continue;
      const perms = permissionsForRole(role.key);
      expect(perms.some((p) => p.startsWith("finance:"))).toBe(false);
    }
  });

  it("verwijst alleen naar bestaande rechten", () => {
    for (const role of ROLE_DEFINITIONS) {
      const perms = permissionsForRole(role.key);
      for (const p of perms) {
        expect(ALL_PERMISSIONS).toContain(p);
      }
    }
  });
});
