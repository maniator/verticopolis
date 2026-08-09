import { describe, it, expect } from "vitest";
import { settingsTemplate } from "./settings";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The Settings dialog structure. It is a STATIC template (no interpolation), so
 * the package here is the semantic structure with its a11y attributes. The
 * stateful behavior lives in the controller and is pinned by `showSettings: the Settings
 * dialog` in `uiDialogs.integration.test.ts`: the sliders initialize from live
 * volumes and apply on input; the switches re-read live state after every toggle;
 * and the OS-forced reduced-motion path disables and relabels the switch.
 */

describe("settingsTemplate structure and a11y", () => {
  it("renders the three volume sliders (0..100 range) with labels and aria-hidden readouts", () => {
    const frag = renderToFragment(settingsTemplate("1.2.3"));
    for (const [id, label] of [
      ["vol-music", "Music"],
      ["vol-ambience", "Ambience"],
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
    const frag = renderToFragment(settingsTemplate("1.2.3"));
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

  it("omits the Building section by default (Classic), renders it as a switch when shown (Modern)", () => {
    expect(renderToFragment(settingsTemplate("1.2.3")).querySelector("#set-auto-bridge")).toBeNull();
    const frag = renderToFragment(settingsTemplate("1.2.3", true));
    const sw = frag.querySelector<HTMLInputElement>("#set-auto-bridge")!;
    expect(sw.getAttribute("type")).toBe("checkbox");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-describedby")).toBe("note-auto-bridge");
    expect(frag.querySelector("#note-auto-bridge")).not.toBeNull();
  });

  it("omits the Privacy section off desktop, renders it as a switch on a desktop build", () => {
    // Desktop-only (issue #781): a browser session keeps nothing about the
    // player to turn off, so it gets no row at all.
    expect(renderToFragment(settingsTemplate("1.2.3")).querySelector("#set-analytics")).toBeNull();
    expect(renderToFragment(settingsTemplate("1.2.3", true)).querySelector("#set-analytics")).toBeNull();
    const frag = renderToFragment(settingsTemplate("1.2.3", false, true));
    const sw = frag.querySelector<HTMLInputElement>("#set-analytics")!;
    expect(sw.getAttribute("type")).toBe("checkbox");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-describedby")).toBe("note-analytics");
    expect(frag.querySelector("#note-analytics")).not.toBeNull();
    // It points at the in-game Privacy text and carries no link: the shell's
    // external-link policy allows one host, and the full note already ships here.
    expect(frag.querySelector("#note-analytics")!.textContent).toContain("Help, under Privacy");
    expect(frag.querySelector("#note-analytics")!.querySelector("a")).toBeNull();
  });

  it("renders the primary Close action with autofocus", () => {
    const frag = renderToFragment(settingsTemplate("1.2.3"));
    const close = frag.querySelector<HTMLButtonElement>('[data-act="close"]')!;
    expect(close.textContent).toBe("Close");
    expect([...close.classList].sort()).toEqual(["btn", "primary"]); // full set, not just primary
    expect(close.hasAttribute("autofocus")).toBe(true);
  });

  it("echoes the app version behind the .app-version class so screenshots mask it", () => {
    // The version is a read-only echo of the splash and Help's About line. It must
    // carry `.app-version` so pgMaskVersion rewrites it to a fixed placeholder in
    // captures (a routine version bump must not churn the committed gallery).
    const frag = renderToFragment(settingsTemplate("9.9.9"));
    const ver = frag.querySelector<HTMLElement>(".set-version .app-version")!;
    expect(ver).not.toBeNull();
    expect(ver.textContent).toBe("v9.9.9");
  });
});

describe("settingsTemplate escapes the interpolated version as text", () => {
  it("renders a hostile version string as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(settingsTemplate(hostile));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(`Verticopolis v${hostile}`);
  });
});
