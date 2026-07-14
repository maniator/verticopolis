import { describe, it, expect } from "vitest";
import { newTowerTemplate } from "./newTower";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The Found a New Tower rule-set picker. Package: both mode radios (Classic
 * pre-checked), the always-rendered calendar sub-picker with its default, and the
 * abandon warning gated on `hasSave`. The Found/Cancel commit
 * logic (reading the picked mode and, for Modern, the calendar) lives in the
 * controller and is pinned by the newTowerModal integration tests.
 */

describe("newTowerTemplate structure and defaults", () => {
  it("offers both rule-sets with Classic pre-checked", () => {
    const frag = renderToFragment(newTowerTemplate(false));
    const classic = frag.querySelector<HTMLInputElement>('input[name="nt-mode"][value="classic"]')!;
    const modern = frag.querySelector<HTMLInputElement>('input[name="nt-mode"][value="modern"]')!;
    expect(classic.checked).toBe(true);
    expect(modern.checked).toBe(false);
  });

  it("always renders the calendar sub-picker, with real-world length pre-checked", () => {
    // The calendar block must render in both modes (Classic ignores it, but the
    // markup and tab order stay put). It is never conditional on the mode.
    const frag = renderToFragment(newTowerTemplate(false));
    expect(frag.querySelector(".nt-calendar")).not.toBeNull();
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
    // The calendar still renders alongside the warning.
    expect(frag.querySelector(".nt-calendar")).not.toBeNull();
  });

  it("omits the warning when there is no tower to lose", () => {
    const frag = renderToFragment(newTowerTemplate(false));
    expect(frag.querySelector(".nt-abandon")).toBeNull();
  });
});
