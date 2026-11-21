import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

// scrypt parameters live here and nowhere else. They are stored inside every hash, so raising them later
// only affects new hashes and old ones keep verifying.
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

// The one place the documented demo password is written. Never print or log it.
const DEFAULT_DEMO_PASSWORD = "harborline-demo";
export const demoPassword = () => process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;

// Stored as "scrypt$N$r$p$salt$hash" (base64url), with a fresh random salt per call.
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

// Constant-time compare. A malformed stored value is simply "no match", never an exception.
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  try {
    const got = scryptSync(password, Buffer.from(salt, "base64url"), want.length, { N: Number(n), r: Number(r), p: Number(p) });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// seed and import call this: every sample user gets the demo password (re-running resets it).
// ponytail: about 40 ms per user, so it is NOT called from importDataset itself (tests import often).
export function setDemoPasswords(db: Database.Database): number {
  const set = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
  const ids = db.prepare("SELECT id FROM users").all() as { id: number }[];
  db.transaction(() => ids.forEach(({ id }) => set.run(hashPassword(demoPassword()), id)))();
  return ids.length;
}
