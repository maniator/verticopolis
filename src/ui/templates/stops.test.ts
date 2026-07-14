import { describe, it, expect, vi } from "vitest";
import { stopsHtml } from "../uiTemplates";
import { stopsTemplate, type StopFloor } from "./stops";
import { renderToFragment, assertDomEquivalent } from "../testing/litTestUtils";

/**
 * The per-floor elevator stops dialog. Package: one `.stop-row` per floor with
 * the floor/basement label and the lobby tag, the checkbox `checked` reflecting
 * the stop state, the inline `@change` reporting `(floor, checked)`, the
 * auto-escaped title, and the transitional `assertDomEquivalent` guard against
 * `stopsHtml`. The Done action lives in the controller and is pinned by the
 * showStopsDialog integration test.
 */

const noToggle = () => {};

describe("stopsTemplate structure and labels", () => {
  it("renders one row per floor, labeling positive floors and basements", () => {
    const floors: StopFloor[] = [
      { floor: 5, stop: true, lobby: false },
      { floor: 1, stop: true, lobby: true },
      { floor: -2, stop: false, lobby: false },
    ];
    const frag = renderToFragment(stopsTemplate("Express", floors, noToggle));
    expect(frag.querySelectorAll(".stop-row")).toHaveLength(3);
    expect(frag.textContent).toContain("Floor 5");
    expect(frag.textContent).toContain("B2");
  });

  it("tags only the lobby floor", () => {
    const floors: StopFloor[] = [
      { floor: 5, stop: true, lobby: false },
      { floor: 1, stop: true, lobby: true },
    ];
    const frag = renderToFragment(stopsTemplate("Express", floors, noToggle));
    const tags = frag.querySelectorAll(".stop-lobby");
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe("lobby");
  });

  it("reflects the stop state onto each checkbox", () => {
    const floors: StopFloor[] = [
      { floor: 5, stop: true, lobby: false },
      { floor: 6, stop: false, lobby: false },
    ];
    const frag = renderToFragment(stopsTemplate("Express", floors, noToggle));
    expect(frag.querySelector<HTMLInputElement>('[data-floor="5"]')!.checked).toBe(true);
    expect(frag.querySelector<HTMLInputElement>('[data-floor="6"]')!.checked).toBe(false);
  });
});

describe("stopsTemplate inline @change reports the floor and new state", () => {
  it("calls onToggle with the row's floor and the checkbox's new checked value", () => {
    const onToggle = vi.fn();
    const floors: StopFloor[] = [{ floor: 5, stop: true, lobby: false }];
    const frag = renderToFragment(stopsTemplate("Express", floors, onToggle));
    const box = frag.querySelector<HTMLInputElement>('[data-floor="5"]')!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(5, false);
  });

  it("passes a basement floor's own (negative) number", () => {
    const onToggle = vi.fn();
    const floors: StopFloor[] = [{ floor: -2, stop: false, lobby: false }];
    const frag = renderToFragment(stopsTemplate("Express", floors, onToggle));
    const box = frag.querySelector<HTMLInputElement>('[data-floor="-2"]')!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(-2, true);
  });
});

describe("stopsTemplate escapes the title as text", () => {
  it("renders a hostile title as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(stopsTemplate(hostile, [], noToggle));
    expect(frag.querySelector("h2 img")).toBeNull();
    expect(frag.querySelector("h2")!.textContent).toBe(`${hostile}: Stops`);
  });
});

describe("stopsTemplate matches the legacy stopsHtml structure", () => {
  const floors: StopFloor[] = [
    { floor: 5, stop: true, lobby: false },
    { floor: 1, stop: true, lobby: true },
    { floor: -2, stop: false, lobby: false },
  ];

  it("holds across positive floors, a lobby row, a basement, and mixed checked state", () => {
    expect(() => assertDomEquivalent(stopsHtml("Express", floors), stopsTemplate("Express", floors, noToggle))).not.toThrow();
  });

  it("holds for an empty floor list", () => {
    expect(() => assertDomEquivalent(stopsHtml("Express", []), stopsTemplate("Express", [], noToggle))).not.toThrow();
  });
});
