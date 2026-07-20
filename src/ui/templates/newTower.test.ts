import { describe, it, expect } from "vitest";
import { newTowerTemplate } from "./newTower";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The Found a New Tower rule-set picker. Package: both mode radios (Classic
 * pre-checked), the Modern-only reveal (the "Modern adds" label and the
 * calendar pace picker, both nested inside `.nt-modern-only` within `.nt-choice`
 * so the stylesheet can gate them on the Modern radio), and the abandon warning
 * gated on `hasSave`. The Found/Cancel commit logic (reading the picked mode
 * and, for Modern, the calendar) lives in the controller and is pinned by the
 * newTowerModal integration tests. Visibility is CSS-driven, so the calendar
 * markup and its default stay present in the fragment regardless of mode.
 */

describe("newTowerTemplate structure and defaults", () => {
  it("offers both rule-sets with Classic pre-checked", () => {
    const frag = renderToFragment(newTowerTemplate(false));
    const classic = frag.querySelector<HTMLInputElement>('input[name="nt-mode"][value="classic"]')!;
    const modern = frag.querySelector<HTMLInputElement>('input[name="nt-mode"][value="modern"]')!;
    expect(classic.checked).toBe(true);
    expect(modern.checked).toBe(false);
  });

  it("nests the calendar and the Modern label inside the Modern-only reveal", () => {
    // The calendar and the "Modern adds" label live inside `.nt-modern-only`,
    // which itself lives inside `.nt-choice`. The stylesheet reveals that block
    // only when the Modern radio is checked; the markup stays present either way
    // (jsdom applies no CSS), so both nodes resolve here.
    const frag = renderToFragment(newTowerTemplate(false));
    const choice = frag.querySelector(".nt-choice")!;
    const reveal = choice.querySelector(".nt-modern-only")!;
    expect(reveal).not.toBeNull();
    expect(reveal.querySelector(".nt-calendar")).not.toBeNull();
    expect(reveal.querySelector(".nt-adds")).not.toBeNull();
  });

  it("keeps the calendar's real-world default pre-checked even while collapsed", () => {
    // The controller reads `nt-cal` only for Modern, so the sane default must
    // survive founding Modern without ever opening the picker.
    const frag = renderToFragment(newTowerTemplate(false));
    const real = frag.querySelector<HTMLInputElement>('input[name="nt-cal"][value="realWorld"]')!;
    const canon = frag.querySelector<HTMLInputElement>('input[name="nt-cal"][value="canon"]')!;
    expect(real.checked).toBe(true);
    expect(canon.checked).toBe(false);
  });

  it("offers Found and Cancel actions", () => {
    const frag = renderToFragment(newTowerTemplate(false));
    expect(frag.querySelector('[data-act="found"]')?.textContent).toBe("Found Tower");
    expect(frag.querySelector('[data-act="cancel"]')?.textContent).toBe("Cancel");
  });

  it("carries the full comparison in a collapsed .nt-compare details, in both modes", () => {
    // The shared compareTemplate lives beneath the mode cards in a COLLAPSED
    // <details>, so the dialog stays a commitment by default while the whole
    // comparison is one click away before founding. It sits outside
    // `.nt-modern-only`, so it is reachable under Classic too (no CSS here, but
    // structurally it must not be nested in the Modern-only block).
    const frag = renderToFragment(newTowerTemplate(false));
    const details = frag.querySelector<HTMLDetailsElement>("details.nt-compare")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.closest(".nt-modern-only")).toBeNull();
    expect(details.querySelector("summary")?.textContent?.trim()).toBe("Classic vs Modern: the full comparison");
    // A signature phrase from the shared body is present.
    expect(details.textContent).toContain("pixel-faithful to 1994");
    expect(details.textContent).toContain("Variant households");
  });

  it("keeps the three-feature teaser and adds no 'Modern adds N' count", () => {
    // Parity-pride: the founding screen names three headline Modern features but
    // never a feature count, and the pointer now sends the reader to the inline
    // comparison rather than the Help screen.
    const frag = renderToFragment(newTowerTemplate(false));
    const adds = frag.querySelector(".nt-adds")!;
    expect(adds.querySelectorAll(".nt-feature").length).toBe(3);
    // No "see the full comparison below" pointer: the collapsed .nt-compare
    // details right below is self-labeled, so the pointer was redundant.
    expect(frag.querySelector(".nt-more")).toBeNull();
    expect(frag.textContent).not.toMatch(/Modern adds \d/);
  });
});

describe("newTowerTemplate abandon warning, gated on an existing tower", () => {
  it("folds in the warning when a tower exists to lose", () => {
    const frag = renderToFragment(newTowerTemplate(true));
    expect(frag.querySelector(".nt-abandon")).not.toBeNull();
    // The Modern-only reveal still renders alongside the warning.
    expect(frag.querySelector(".nt-modern-only")).not.toBeNull();
  });

  it("omits the warning when there is no tower to lose", () => {
    const frag = renderToFragment(newTowerTemplate(false));
    expect(frag.querySelector(".nt-abandon")).toBeNull();
  });
});
