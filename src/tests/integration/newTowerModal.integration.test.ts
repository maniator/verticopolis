// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";

// The founding dialog reports the Modern bridging choice; the spy stands in
// for the analytics send so the test can read what was reported.
const sent = vi.hoisted(() => ({ trackAppAction: vi.fn() }));
vi.mock("../../analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics")>()),
  trackAppAction: sent.trackAppAction,
}));

/**
 * The New Tower dialog (`newTowerModal`): which rule-set, calendar and
 * bridging choice it hands to `onFound`. "Bridge floors between rooms" starts
 * unticked (owner, 2026-11-15), so a new Modern tower is founded unbridged
 * unless the player ticks it.
 */

const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
const click = (sel: string): void => {
  const el = dialog().querySelector<HTMLElement>(sel);
  expect(el, `expected a "${sel}" element in the open dialog`).not.toBeNull();
  el!.click();
};

beforeEach(() => {
  mountAppDom();
  sent.trackAppAction.mockClear();
});

describe("newTowerModal: the rule-set picker", () => {
  it("founds Classic by default (the pre-checked mode), with the harmless default calendar", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("classic", "realWorld", false);
    expect(dialog().open).toBe(false); // and it closes on commit
  });

  it("founds Modern unbridged when that radio is chosen (real-world calendar by default)", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[value="modern"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("modern", "realWorld", true);
    expect(sent.trackAppAction).toHaveBeenCalledWith("found_bridged", "off");
  });

  it("passes the Modern short-calendar choice when picked", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[value="modern"]')!.checked = true;
    dialog().querySelector<HTMLInputElement>('input[name="nt-cal"][value="canon"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("modern", "canon", true);
  });

  it("Bridge floors between rooms starts unticked, worded as in Settings", () => {
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound: vi.fn() });
    const box = dialog().querySelector<HTMLInputElement>('input[name="nt-bridged"]')!;
    expect(box.checked).toBe(false);
    expect(box.closest("label")!.textContent).toContain("Bridge floors between rooms");
    expect(dialog().textContent).not.toContain("Don't bridge");
  });

  it("founds Modern bridged when Bridge floors between rooms is ticked", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[value="modern"]')!.checked = true;
    dialog().querySelector<HTMLInputElement>('input[name="nt-bridged"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("modern", "realWorld", false);
    expect(sent.trackAppAction).toHaveBeenCalledWith("found_bridged", "on");
  });

  it("ignores the bridging checkbox when founding Classic", () => {
    // The bridging switch is Modern-only; a Classic founding pins bridged
    // whatever the (Modern-only) checkbox says, and reports no Modern choice.
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    expect(dialog().querySelector<HTMLInputElement>('input[name="nt-bridged"]')!.checked).toBe(false);
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("classic", "realWorld", false);
    expect(sent.trackAppAction).not.toHaveBeenCalledWith("found_bridged", expect.anything());
  });

  it("ignores the calendar radio when founding Classic (persists the harmless default)", () => {
    // A Classic save's calendar is derived, not read from the persisted field,
    // so persisting "canon" here would only quietly contradict the contract.
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    // Classic pre-checked; a user toggles the Modern-calendar radio anyway.
    dialog().querySelector<HTMLInputElement>('input[name="nt-cal"][value="canon"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("classic", "realWorld", false);
  });

  it("cancels without founding anything", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: true, onFound });
    click('[data-act="cancel"]');
    expect(onFound).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("folds in the abandon warning only when a tower exists to lose", () => {
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: true, onFound: vi.fn() });
    expect(dialog().querySelector(".nt-abandon")).not.toBeNull();
    ui.closeModal();
    ui.newTowerModal({ hasSave: false, onFound: vi.fn() });
    expect(dialog().querySelector(".nt-abandon")).toBeNull();
  });
});
