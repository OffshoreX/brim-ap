// Unicode hygiene for names and addresses. Pure functions, no DB, no LLM.

// Bidi controls can make text display in a different order than it is stored ("Trojan Source"). U+202A-202E and U+2066-2069.
export const stripBidi = (s: string) => s.replace(/[‪-‮⁦-⁩]/g, "");

// NFKC folds look-alike forms into plain ones (fullwidth "Ａ" -> "A", "ﬁ" -> "fi"); bidi controls are removed too.
export const cleanText = (s: string) => stripBidi(s.normalize("NFKC"));

// Same, for every string inside a value (used on extraction output and audit rows). Non-strings pass through.
export function cleanDeep<T>(v: T): T {
  if (typeof v === "string") return stripBidi(v) as T; // NFKC is only for matching keys; shown text keeps its own letters
  if (Array.isArray(v)) return v.map(cleanDeep) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x)])) as T;
  return v;
}

// A word that mixes Latin with Cyrillic or Greek letters is how "Pacific Fuel" is spelled with a Cyrillic "а".
export function hasMixedScripts(s: string): boolean {
  return s.normalize("NFKC").split(/[^\p{L}\p{M}]+/u).some((w) => [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u].filter((r) => r.test(w)).length > 1);
}

// Cyrillic and Greek letters that look like a Latin one. A short table on purpose: the common ones, not all of Unicode's confusables.
const LOOKALIKE: Record<string, string> = {
  а: "a", в: "b", с: "c", е: "e", н: "h", к: "k", м: "m", о: "o", р: "p", т: "t", х: "x", у: "y", і: "i", ј: "j", ѕ: "s", ԁ: "d", ԛ: "q", ԝ: "w",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", γ: "y",
};
// What a human would read: lower case, accents off, look-alike letters turned into Latin, only letters and digits kept.
export const skeleton = (s: string) =>
  [...s.normalize("NFKC").slice(0, 500).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()].map((c) => LOOKALIKE[c] ?? c).join("").replace(/[^\p{L}\p{N}]/gu, "");

// Existing names that read the same as `name` but are not spelled the same: the signature of an impersonation.
export function lookalikes<T extends { name: string }>(name: string, existing: T[], plainKey: (s: string) => string): T[] {
  const sk = skeleton(name);
  return sk ? existing.filter((e) => skeleton(e.name) === sk && plainKey(e.name) !== plainKey(name)) : [];
}
