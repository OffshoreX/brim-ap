import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the accessibility rules in ui.css that are easy to undo by accident.
const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8");

describe("ui.css accessibility rules", () => {
  it("uses the DESIGN.md focus and field-border tokens, with a white ring on the top bar", () => {
    expect(css).toMatch(/--focus:#1d4ed8/);
    expect(css).toMatch(/--field-border:#7d8797/);
    expect(css).toMatch(/\.topbar :focus-visible \{ outline-color: #fff/);
  });
  it("keeps chart text at 12px or larger by giving the svg its viewBox width as a minimum", () => {
    expect(css).toMatch(/\.chart text \{[^}]*font-size: 12px/);
    expect(css).toMatch(/\.chart svg \{[^}]*min-width: 640px/);
  });
  it("has no stray colour literals or 2px radii outside :root", () => {
    const rest = css.slice(css.indexOf("}") + 1);
    expect(rest).not.toMatch(/#9ca3af|#6b7280|border-radius: 2px/);
  });
});
