import { expect, test } from "vitest";
import { createLimiter } from "./loginLimiter";

test("5 failures lock a key for 10 minutes, then it unlocks (injected clock)", () => {
  let t = 1_000_000;
  const l = createLimiter(() => t);
  for (let i = 0; i < 4; i++) l.fail("email:a");
  expect(l.isLocked("email:a")).toBe(false);
  expect(l.fail("email:a")).toBe(5);
  expect(l.isLocked("email:a")).toBe(true);
  expect(l.isLocked("email:b")).toBe(false); // other keys are independent
  t += 10 * 60 * 1000 - 1;
  expect(l.isLocked("email:a")).toBe(true);
  t += 1;
  expect(l.isLocked("email:a")).toBe(false);
});

test("failures older than the window do not count, and clear() resets a key", () => {
  let t = 0;
  const l = createLimiter(() => t);
  for (let i = 0; i < 4; i++) l.fail("ip:1");
  t += 11 * 60 * 1000;
  expect(l.fail("ip:1")).toBe(1);
  for (let i = 0; i < 4; i++) l.fail("ip:1");
  l.clear("ip:1");
  expect(l.isLocked("ip:1")).toBe(false);
});
