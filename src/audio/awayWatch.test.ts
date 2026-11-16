import { describe, it, expect, vi } from "vitest";
import { watchAway, type AwayWatchTarget } from "./awayWatch";

/** A page whose focus and visibility the test sets, then announces. */
function fakePage() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState, focused: true });
  const target: AwayWatchTarget = {
    win: win as unknown as AwayWatchTarget["win"],
    doc: Object.assign(doc, { hasFocus: () => doc.focused }) as unknown as AwayWatchTarget["doc"],
  };
  return {
    target,
    blur: () => ((doc.focused = false), win.dispatchEvent(new Event("blur"))),
    focus: () => ((doc.focused = true), win.dispatchEvent(new Event("focus"))),
    hide: () => ((doc.visibilityState = "hidden"), doc.dispatchEvent(new Event("visibilitychange"))),
    show: () => ((doc.visibilityState = "visible"), doc.dispatchEvent(new Event("visibilitychange"))),
  };
}

describe("watchAway", () => {
  it("reports the state at once: here on a focused, visible page", () => {
    const page = fakePage();
    const onChange = vi.fn();
    watchAway(page.target, onChange);
    expect(onChange.mock.calls).toEqual([[false]]);
  });

  it("reports away when another app or window takes focus, and back on return", () => {
    const page = fakePage();
    const onChange = vi.fn();
    watchAway(page.target, onChange);
    page.blur();
    page.focus();
    expect(onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it("reports away when the tab is hidden, once, even as focus leaves with it", () => {
    const page = fakePage();
    const onChange = vi.fn();
    watchAway(page.target, onChange);
    page.hide();
    page.blur();
    page.show(); // visible again, but focus has not come back yet
    page.focus();
    expect(onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it("hears nothing more once stopped", () => {
    const page = fakePage();
    const onChange = vi.fn();
    const stop = watchAway(page.target, onChange);
    stop();
    page.blur();
    page.hide();
    expect(onChange.mock.calls).toEqual([[false]]);
  });
});
