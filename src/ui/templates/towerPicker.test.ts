import { describe, it, expect, vi } from "vitest";
import type { SlotInfo } from "../../storage/SaveGame";
import { towerPickerTemplate, type TowerPickerHandlers } from "./towerPicker";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The title screen's load-only tower picker (SPEC-splash-load-tower CAP-2 to
 * CAP-4). Package: the three row variants keyed on RAW presence, the total
 * absence of write controls, the always-present file row, and the two
 * nothing-loadable states. The dismissal contract (CAP-5) and the re-pause
 * (CAP-6) live in the controller and in adoptSim, pinned by the splash
 * integration tests.
 */

const AT = 1_700_000_000_000;

const handlers = (over: Partial<TowerPickerHandlers> = {}): TowerPickerHandlers => ({
  onLoad: vi.fn(() => true),
  onFile: vi.fn(),
  onBack: vi.fn(),
  ...over,
});

const loadable = (slot: number | "auto"): SlotInfo => ({
  slot,
  exists: true,
  present: true,
  towerName: "Sixseven",
  star: 3,
  population: 4200,
  funds: 900_000,
  savedAt: AT,
  mode: "classic",
  day: 88,
});
const unreadable = (slot: number | "auto"): SlotInfo => ({ slot, exists: false, present: true });
const absent = (slot: number | "auto"): SlotInfo => ({ slot, exists: false, present: false });

const render = (slots: SlotInfo[], h = handlers(), error: string | null = null) =>
  renderToFragment(towerPickerTemplate(slots, error, h));

describe("towerPickerTemplate row variants (CAP-2)", () => {
  it("gives a readable slot a Load control and the shared tower summary", () => {
    const row = render([loadable(2)]).querySelectorAll(".slot")[0];
    expect(row.querySelector('[data-picker="load"]')).not.toBeNull();
    expect(row.textContent).toContain("Slot 2");
    expect(row.textContent).toContain("Sixseven");
    expect(row.textContent).toContain("Day 88");
  });

  it("shows a present-but-unreadable slot, labeled, with NO control at all", () => {
    // Not hidden: a save written by a newer build is unreadable HERE and may be
    // recovered later, so claiming the tower is gone would be a lie. Not a
    // DISABLED button either, which would invite a tap that can never work.
    const row = render([unreadable(1)]).querySelectorAll(".slot")[0];
    expect(row.textContent).toContain("Couldn't be read by this version.");
    expect(row.querySelector("button")).toBeNull();
    expect(row.querySelector(".slot-unreadable")).not.toBeNull();
  });

  it("shows an absent slot as empty, with no control", () => {
    const row = render([loadable(1), absent(2)]).querySelectorAll(".slot")[1];
    expect(row.querySelector(".slot-empty")).not.toBeNull();
    expect(row.querySelector("button")).toBeNull();
  });

  it("keys the variants on RAW presence, not the parse-based exists flag", () => {
    // Both rows carry exists:false; only `present` tells them apart. Reading
    // `exists` alone would collapse the unreadable row into "empty" and hide a
    // recoverable tower.
    const frag = render([unreadable(1), absent(2)]);
    const rows = frag.querySelectorAll(".slot");
    expect(rows[0].textContent).toContain("Couldn't be read");
    expect(rows[1].textContent).toContain("empty");
  });
});

describe("towerPickerTemplate carries no write controls (CAP-2)", () => {
  it("renders no Save, Delete, or Export anywhere, in any row state", () => {
    // The correctness rule, not a style preference: on the title screen the
    // live sim may be the throwaway boot sim, and saveToSlot would SUCCEED
    // against it rather than throw, writing an empty tower with a real
    // timestamp. See the module docblock.
    const frag = render([loadable("auto"), loadable(1), unreadable(2), absent(3)]);
    expect(frag.querySelector("[data-save]")).toBeNull();
    expect(frag.querySelector("[data-del]")).toBeNull();
    expect(frag.querySelector('[data-act="export"]')).toBeNull();
    const labels = Array.from(frag.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(labels).not.toContain("Save");
    expect(labels).not.toContain("Export to file");
    expect(labels.filter((l) => l === "Load")).toHaveLength(2);
  });
});

describe("towerPickerTemplate file row (CAP-3)", () => {
  it("is present with every slot populated", () => {
    const frag = render([loadable("auto"), loadable(1)]);
    expect(frag.querySelector('[data-picker="file"]')).not.toBeNull();
  });

  it("is present when nothing is saved on the device", () => {
    // The whole point for a fresh install or a new device: storage is empty and
    // the only tower the player has is a .vctower in their downloads.
    const frag = render([absent("auto"), absent(1)]);
    expect(frag.querySelector('[data-picker="file"]')).not.toBeNull();
  });

  it("is present when every slot is unreadable", () => {
    const frag = render([unreadable("auto"), unreadable(1)]);
    expect(frag.querySelector('[data-picker="file"]')).not.toBeNull();
  });

  it("names the accepted formats in text, not only in the OS picker's filter", () => {
    // Android pickers grey out extensions they do not know, so the text is the
    // only reliable place the player learns what to hunt for.
    const row = render([absent(1)]).querySelector(".slot-file")!;
    expect(row.textContent).toContain(".vctower");
    expect(row.textContent).toContain(".TDT");
  });

  it("renders last, after every slot row", () => {
    const rows = Array.from(render([loadable(1), absent(2)]).querySelectorAll(".slot"));
    expect(rows[rows.length - 1].classList.contains("slot-file")).toBe(true);
  });
});

describe("towerPickerTemplate empty and error states (CAP-4)", () => {
  it("collapses to one honest line when NOTHING is present, not a wall of empty rows", () => {
    const frag = render([absent("auto"), absent(1), absent(2), absent(3)]);
    expect(frag.querySelector(".picker-none")!.textContent).toBe("No towers saved on this device.");
    // The file row is the only .slot left.
    expect(frag.querySelectorAll(".slot")).toHaveLength(1);
    expect(frag.querySelector(".slot-file")).not.toBeNull();
  });

  it("still lists rows when slots are present but none parse", () => {
    // This player's storage went bad. The rows are their evidence and the file
    // row underneath is their recovery, so neither may be collapsed away.
    const frag = render([unreadable("auto"), absent(1)]);
    expect(frag.querySelector(".picker-none")).toBeNull();
    expect(frag.querySelectorAll(".slot")).toHaveLength(3); // 2 slots + file row
  });

  it("renders an inline error as an alert when one is passed", () => {
    const frag = render([loadable(1)], handlers(), "That tower couldn't be read.");
    const err = frag.querySelector(".picker-error")!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn't be read");
  });

  it("renders no error element by default", () => {
    expect(render([loadable(1)]).querySelector(".picker-error")).toBeNull();
  });
});

describe("towerPickerTemplate dispatch", () => {
  it("routes a row's Load to onLoad with that slot id", () => {
    const h = handlers();
    const frag = render([loadable("auto"), loadable(2)], h);
    frag.querySelectorAll<HTMLButtonElement>('[data-picker="load"]')[0].click();
    expect(h.onLoad).toHaveBeenCalledWith("auto");
    frag.querySelectorAll<HTMLButtonElement>('[data-picker="load"]')[1].click();
    expect(h.onLoad).toHaveBeenCalledWith(2);
  });

  it("routes the file row and Back to their own handlers", () => {
    const h = handlers();
    const frag = render([absent(1)], h);
    frag.querySelector<HTMLButtonElement>('[data-picker="file"]')!.click();
    expect(h.onFile).toHaveBeenCalledOnce();
    frag.querySelector<HTMLButtonElement>('[data-picker="back"]')!.click();
    expect(h.onBack).toHaveBeenCalledOnce();
  });
});
