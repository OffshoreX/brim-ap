import { afterEach, expect, test } from "vitest";
import { demoPassword, hashPassword, verifyPassword } from "./password";

afterEach(() => delete process.env.DEMO_PASSWORD);

test("hash verifies the right password only, and never contains it", () => {
  const h = hashPassword("correct horse");
  expect(verifyPassword("correct horse", h)).toBe(true);
  expect(verifyPassword("correct horsE", h)).toBe(false);
  expect(verifyPassword("", h)).toBe(false);
  expect(h).not.toContain("correct horse");
});

test("random salt: the same password hashes differently each time", () => {
  expect(hashPassword("same")).not.toBe(hashPassword("same"));
});

test("malformed stored values are a plain no-match, not an exception", () => {
  for (const bad of ["", "plain", "scrypt$1$2$3", "md5$a$b$c$d$e", "scrypt$x$y$z$AA$BB"]) expect(verifyPassword("x", bad)).toBe(false);
});

test("demo password comes from DEMO_PASSWORD, with a documented fallback", () => {
  expect(demoPassword()).toBe("harborline-demo");
  process.env.DEMO_PASSWORD = "other-demo";
  expect(demoPassword()).toBe("other-demo");
});
