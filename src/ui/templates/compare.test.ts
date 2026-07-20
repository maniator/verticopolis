import { describe, it, expect } from "vitest";
import { compareTemplate, compareModalTemplate } from "./compare";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The shared Classic vs Modern comparison body. This is the single source the
 * Help dialog, the in-game Compare modal, and the founding screen all render, so
 * pin that it carries every divergence phrase and the parity-pride closer. The
 * Help-side drift guard (help.test.ts `RULE_TO_HELP`) still owns the map from
 * GameRules members to copy; this only proves the extracted body is complete and
 * that the modal wrapper frames it.
 */

// One distinct phrase per divergence bullet, mirroring the Help drift guard.
const DIVERGENCE_PHRASES = [
  "Variant households",
  "move out on its own",
  "monthly overhead",
  "Continuous pricing",
  "switch elevators at any shared stop",
  "Smarter scheduling",
  "paid exterminator",
  "Hovering an invalid spot",
  "linger past checkout",
  "Calendar pace",
];

describe("compareTemplate", () => {
  it("renders every divergence phrase and the pixel-faithful closer", () => {
    const text = renderToFragment(compareTemplate()).textContent ?? "";
    for (const phrase of DIVERGENCE_PHRASES) {
      expect(text, `compareTemplate is missing "${phrase}"`).toContain(phrase);
    }
    expect(text).toContain("pixel-faithful to 1994");
  });

  it("is body-only: no <details>/<summary> or <h2> wrapper", () => {
    const frag = renderToFragment(compareTemplate());
    expect(frag.querySelector("details")).toBeNull();
    expect(frag.querySelector("summary")).toBeNull();
    expect(frag.querySelector("h2")).toBeNull();
  });
});

describe("compareModalTemplate", () => {
  it("frames the shared body under an h2 with a close button", () => {
    const frag = renderToFragment(compareModalTemplate());
    expect(frag.querySelector("h2")?.textContent).toBe("Classic vs Modern");
    const close = frag.querySelector<HTMLButtonElement>('[data-act="close"]')!;
    expect(close.textContent).toBe("Got it");
    expect(close.hasAttribute("autofocus")).toBe(true);
    // The same shared body is inside the modal.
    expect(frag.textContent).toContain("pixel-faithful to 1994");
    expect(frag.textContent).toContain("Variant households");
  });
});
