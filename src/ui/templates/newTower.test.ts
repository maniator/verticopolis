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
