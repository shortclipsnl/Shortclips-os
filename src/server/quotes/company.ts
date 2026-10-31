import "server-only";
import { getStringSetting, setStringSetting } from "@/server/app-settings";

/**
 * Shortclips' eigen bedrijfsgegevens voor de offertekop/PDF. Er is geen
 * bedrijfstabel; we bewaren deze als app-instellingen (categorie "company").
 */

export type CompanyInfo = {
  name: string;
  address: string;
  postalCity: string;
  kvk: string;
  btw: string;
  iban: string;
  email: string;
  phone: string;
  website: string;
};

const KEYS: Record<keyof CompanyInfo, string> = {
  name: "company.name",
  address: "company.address",
  postalCity: "company.postal_city",
  kvk: "company.kvk",
  btw: "company.btw",
  iban: "company.iban",
  email: "company.email",
  phone: "company.phone",
  website: "company.website",
};

const DEFAULTS: CompanyInfo = {
  name: "Shortclips",
  address: "",
  postalCity: "",
  kvk: "",
  btw: "",
  iban: "",
  email: "info@shortclips.nl",
  phone: "",
  website: "shortclips.nl",
};

export async function getCompanyInfo(): Promise<CompanyInfo> {
  const entries = await Promise.all(
    (Object.keys(KEYS) as (keyof CompanyInfo)[]).map(async (k) => [k, await getStringSetting(KEYS[k], DEFAULTS[k])] as const),
  );
  return Object.fromEntries(entries) as CompanyInfo;
}

export async function setCompanyInfo(patch: Partial<CompanyInfo>, updatedById?: string): Promise<void> {
  await Promise.all(
    (Object.keys(patch) as (keyof CompanyInfo)[]).map((k) =>
      setStringSetting(KEYS[k], String(patch[k] ?? ""), { category: "company", updatedById }),
    ),
  );
}
