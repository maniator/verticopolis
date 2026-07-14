import { describe, it, expect } from "vitest";
import { settingsHtml } from "../uiTemplates";
import { settingsTemplate } from "./settings";
import { renderToFragment, assertDomEquivalent } from "../testing/litTestUtils";

/**
 * The Settings dialog structure. It is a STATIC template (no interpolation), so
 * the package here is the semantic structure with its a11y attributes and the
 * transitional `assertDomEquivalent` guard against `settingsHtml`. The stateful
 * behavior lives in the controller and is pinned by `showSettings: the Settings
 * dialog` in `uiDialogs.integration.test.ts`: the sliders initialize from live
 * volumes and apply on input; the switches re-read live state after every toggle;
 * and the OS-forced reduced-motion path disables and relabels the switch.
 */

describe("settingsTemplate structure and a11y", () => {
  it("renders the two volume sliders (0..100 range) with labels and aria-hidden readouts", () => {
    const frag = renderToFragment(settingsTemplate());
    for (const [id, label] of [
      ["vol-music", "Music"],
      ["vol-sfx", "Effects"],
    ]) {
      const input = frag.querySelector<HTMLInputElement>(`#${id}`)!;
      expect(input.getAttribute("type")).toBe("range");
      expect([input.getAttribute("min"), input.getAttribute("max"), input.getAttribute("step")]).toEqual(["0", "100", "1"]);
      // The label's `for` points at the slider (a real screen-reader association).
      const lbl = frag.querySelector(`label[for="${id}"]`)!;
      expect(lbl.textContent).toBe(label);
      const readout = frag.querySelector(`[data-vol-val="${id}"]`)!;
      expect(readout.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("renders both presentation toggles as role=switch with aria-describedby to their note", () => {
    const frag = renderToFragment(settingsTemplate());
    for (const [id, note] of [
      ["set-reduce-motion", "note-reduce-motion"],
      ["set-steady-clock", "note-steady-clock"],
    ]) {
      const input = frag.querySelector<HTMLInputElement>(`#${id}`)!;
      expect(input.getAttribute("type")).toBe("checkbox");
      expect(input.getAttribute("role")).toBe("switch");
      expect(input.getAttribute("aria-describedby")).toBe(note);
      expect(frag.querySelector(`#${note}`)).not.toBeNull(); // the describedby target exists
    }
  });

  it("renders the primary Close action with autofocus", () => {
    const frag = renderToFragment(settingsTemplate());
    const close = frag.querySelector<HTMLButtonElement>('[data-act="close"]')!;
    expect(close.textContent).toBe("Close");
    expect([...close.classList].sort()).toEqual(["btn", "primary"]); // full set, not just primary
    expect(close.hasAttribute("autofocus")).toBe(true);
  });
});

describe("settingsTemplate matches the legacy settingsHtml structure", () => {
  it("assertDomEquivalent holds (the transitional regression guard)", () => {
    expect(() => assertDomEquivalent(settingsHtml(), settingsTemplate())).not.toThrow();
  });
});
