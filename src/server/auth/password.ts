import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP-richtlijn voor scrypt: N=2^16, r=8, p=1.
const PARAMS = { N: 65536, r: 8, p: 1, maxmem: 128 * 65536 * 8 * 2 };
const KEYLEN = 64;

/** Formaat: scrypt$N$r$p$saltHex$hashHex — parameters staan in de hash zelf. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEYLEN, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Vaste hash om te vergelijken wanneer een e-mailadres niet bestaat. Zonder dit
 * verraadt de responstijd of een account bestaat.
 */
let dummyHash: string | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword("constant-time-dummy-value");
  await verifyPassword(password, dummyHash);
}
