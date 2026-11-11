import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortCodes } from "../simport/portCodes";
import type { SimView } from "../simport/view";
import { catalogFor } from "../tests/catalogFixture";
import { mockPort, record } from "../tests/portKit/mockPort";
import { onHistoryClick, setHistoryButtons, toast, update, type HudSource } from "./uiStatus";
import type { Catalog } from "../catalog/catalogTypes";
import type { GameMode } from "../shared/types";
import type { UI } from "./UI";
import { useGermanDefaultLocale } from "../tests/localeStub";

/**
 * Toast-rail timer lifecycle. `toast()` only touches `ui.el.toast`, so a bare
 * element behind a cast is enough. Fake timers let us assert that a toast pruned
 * below the TOAST_MAX cap cancels its pending hold/fade timer (issue #368)
 * instead of leaving it to fire on a node already detached from the rail.
 */

const TOAST_MAX = 5; // mirrors the cap in uiStatus.ts

function makeUI(): { ui: UI; rail: HTMLElement } {
  const rail = document.createElement("div");
  const ui = { el: { toast: rail } } as unknown as UI;
  return { ui, rail };
}

describe("toast rail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("caps the rail at TOAST_MAX, pruning the oldest", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX + 3; i++) toast(ui, `t${i}`);
    expect(rail.children.length).toBe(TOAST_MAX);
    // The oldest three were pruned, so the survivors are the newest.
    expect(rail.firstElementChild?.textContent).toBe("t3");
    expect(rail.lastElementChild?.textContent).toBe(`t${TOAST_MAX + 2}`);
  });

  it("cancels a pruned toast's pending timer (no leak past the DOM)", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX + 4; i++) toast(ui, `t${i}`);
    // One pending hold timer per SURVIVING toast; the pruned ones were cleared,
    // so the count is TOAST_MAX, not TOAST_MAX + 4.
    expect(vi.getTimerCount()).toBe(TOAST_MAX);
    // ...and the survivors are the newest, so the cleared timers really were
    // the pruned (oldest) ones, not some other TOAST_MAX of them.
    expect(rail.firstElementChild?.textContent).toBe("t4");
    expect(rail.lastElementChild?.textContent).toBe(`t${TOAST_MAX + 3}`);
  });

  it("cancels a pruned toast's removal timer even when it is pruned mid-fade", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX; i++) toast(ui, `t${i}`);
    vi.advanceTimersByTime(3600); // every toast enters its fade; removal timers now pending
    expect(vi.getTimerCount()).toBe(TOAST_MAX); // TOAST_MAX removal timers, none fired yet
    const fading = rail.firstElementChild; // t0, mid-fade
    toast(ui, "overflow"); // pushes past the cap, pruning t0 while it is still fading
    // t0's 300ms removal timer was cleared on prune. If it had leaked, the count
    // would be TOAST_MAX + 1 (its stale removal timer plus the new toast's hold).
    expect(vi.getTimerCount()).toBe(TOAST_MAX);
    expect(rail.contains(fading!)).toBe(false);
    expect(rail.firstElementChild?.textContent).toBe("t1");
  });

  it("a surviving toast holds, fades, then removes itself", () => {
    const { ui, rail } = makeUI();
    toast(ui, "solo");
    const node = rail.firstElementChild as HTMLElement;
    expect(node.style.opacity).toBe("");
    vi.advanceTimersByTime(3600); // hold elapses, fade begins
    expect(node.style.opacity).toBe("0");
    expect(rail.children.length).toBe(1); // still present, mid-fade
    vi.advanceTimersByTime(300); // fade elapses, node removes itself
    expect(rail.children.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs only the survivors' timers to completion (pruned timers are gone)", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX + 2; i++) toast(ui, `t${i}`);
    // TOAST_MAX survivors, each with one hold timer; the two pruned toasts left
    // no timer behind. Run the clock out: every survivor holds, fades, removes,
    // and nothing is left pending.
    expect(vi.getTimerCount()).toBe(TOAST_MAX);
    vi.advanceTimersByTime(3600 + 300);
    expect(rail.children.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  // The rail is polite (role="status" on #toast-wrap); only a genuine error
  // interrupts, via its own role="alert" (#541 / AUD-020).
  it("marks a 'bad' toast role=alert so errors still interrupt the polite rail", () => {
    const { ui, rail } = makeUI();
    toast(ui, "quota full", "bad");
    expect((rail.lastElementChild as HTMLElement).getAttribute("role")).toBe("alert");
  });

  it("leaves routine good/info toasts polite (no assertive role)", () => {
    const { ui, rail } = makeUI();
    toast(ui, "saved", "good");
    toast(ui, "heads up", "info");
    for (const node of Array.from(rail.children)) {
      expect(node.getAttribute("role")).toBeNull();
    }
  });
});

/** The header the HUD reads: a 1-star Classic tower at 07:00 on day one. */
const HEADER = { money: 2_000_000, star: 1, mode: "classic", logSeq: 0, minutes: 420, day: 0, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 0, weekDays: 7, weekendDays: 2 };

/** A HUD source over a mock port: the strip, the log and the steps it answers,
 *  and a reader whose header a test states. */
function source(header: Partial<typeof HEADER> = {}, strip: Record<string, number> = { population: 6 }, depths: number[] = [0, 0]) {
  const port = mockPort({
    statsStrip: () => record("statsStrip", strip),
    logAfter: () => new Float64Array(0),
    undoDepths: () => Float64Array.from(depths),
  });
  const reader = { header: { ...HEADER, ...header }, tower: { towerName: "Tower One" } } as unknown as Pick<SimView, "header" | "tower">;
  const src: HudSource = { reader, port, codes: new PortCodes(port) };
  return { src, port };
}

/** A UI whose elements are made on demand. The palette, catalog and log keys
 *  already match `header`, so only the status bar, the mode badge, the stats
 *  grid and the Undo and Redo buttons draw. */
function hud(header: Partial<typeof HEADER> = {}) {
  const made: Record<string, HTMLElement> = { undo: document.createElement("button"), redo: document.createElement("button") };
  const el = new Proxy(made, {
    get: (target, key: string) => (target[key] ??= document.createElement("div")),
  });
  const h = { ...HEADER, ...header };
  const catalog = catalogFor("classic");
  let scanKey = h.mode + ":" + h.star;
  for (const f of catalog.facilities) scanKey += h.money >= f.cost ? "1" : "0";
  const ui = { el, cb: { getCatalog: () => catalog }, paletteCatalog: catalog, paletteScanKey: scanKey, lastLogSeq: h.logSeq, tool: { type: "inspect" }, setTowerName: () => {} } as unknown as UI;
  return { ui, el };
}

describe("update", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the stats strip once and labels the population from it", () => {
    const header = { money: 123_456_789 };
    const { ui, el } = hud(header);
    // A population big enough to need a separator, so the grouping shows.
    const { src, port } = source(header, { population: 12_345 });
    // A German default would group with dots; the English UI groups the US way.
    useGermanDefaultLocale();
    update(ui, src);
    expect(port.statsStrip).toHaveBeenCalledOnce();
    expect(el.pop.textContent).toBe("12,345");
    // Funds are in the hundreds of millions here, so they carry separators.
    expect(el.money.textContent).toBe("$123,456,789");
  });

  it("shows funds that round to zero as $0 in the funds color, and a bad value as NaN", () => {
    // A fresh HUD per value, so the reader takes the new funds.
    const shown = (money: number) => {
      const { ui, el } = hud({ money });
      update(ui, source({ money }).src);
      return { text: el.money.textContent, color: el.money.style.color };
    };
    expect(shown(-0.3)).toEqual({ text: "$0", color: "var(--money)" });
    expect(shown(-0.6)).toEqual({ text: "$-1", color: "var(--bad)" });
    expect(shown(NaN).text).toBe("$NaN");
  });

  it("grays out Undo and Redo from the engine's steps on every pump", () => {
    // What the engine holds after an edit, an undo, a redo and a load is its
    // own (engine-rs/src/sim_undo_tests.rs); the HUD shows whatever it answers.
    const { ui, el } = hud();
    const grayed = () => [el.undo, el.redo].map((b) => b.getAttribute("aria-disabled") === "true");
    const pumped: boolean[][] = [];
    for (const depths of [[0, 0], [1, 0], [0, 1], [1, 0], [0, 0]]) {
      const { src, port } = source({}, { population: 6 }, depths);
      update(ui, src);
      expect(port.undoDepths).toHaveBeenCalledOnce();
      pumped.push(grayed());
    }
    expect(pumped).toEqual([[true, true], [false, true], [true, false], [false, true], [true, true]]);
  });
});

describe("the Undo and Redo buttons", () => {
  /** A port holding `depths` steps, [undo, redo]. */
  const holding = (depths: number[]) => ({ undoDepths: () => Float64Array.from(depths) });

  const buttons = () => {
    const undo = document.body.appendChild(document.createElement("button"));
    const redo = document.body.appendChild(document.createElement("button"));
    return { undo, redo, ui: { el: { undo, redo } } as unknown as UI };
  };
  const grayed = (...bs: HTMLButtonElement[]) => bs.map((b) => b.getAttribute("aria-disabled") === "true");

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("gray out while the engine holds no step that way, and come back when it does", () => {
    const { undo, redo, ui } = buttons();
    setHistoryButtons(ui, holding([0, 0]));
    expect(grayed(undo, redo), "a new tower has no steps").toEqual([true, true]);
    setHistoryButtons(ui, holding([1, 0]));
    expect(grayed(undo, redo), "after an edit").toEqual([false, true]);
    setHistoryButtons(ui, holding([0, 1]));
    expect(grayed(undo, redo), "after its undo").toEqual([true, false]);
    setHistoryButtons(ui, holding([0, 0]));
    expect(grayed(undo, redo), "no step either way again").toEqual([true, true]);
  });

  it("keep the focus when they gray out, so Enter or Space stays on the button", () => {
    const { undo, ui } = buttons();
    undo.focus();
    setHistoryButtons(ui, holding([0, 0]));
    expect(undo.disabled, "a disabled button would drop the focus to the page").toBe(false);
    expect(document.activeElement).toBe(undo);
  });

  it("write the page only when a state flips", () => {
    const { undo, ui } = buttons();
    const set = vi.spyOn(undo, "setAttribute");
    const clear = vi.spyOn(undo, "removeAttribute");
    for (const depths of [[0, 0], [0, 0], [1, 0], [1, 0]]) setHistoryButtons(ui, holding(depths));
    expect([set.mock.calls.length, clear.mock.calls.length]).toEqual([1, 1]);
  });

  it("do nothing when pressed while grayed out", () => {
    const { undo, ui } = buttons();
    const run = vi.fn();
    onHistoryClick(undo, run);
    setHistoryButtons(ui, holding([0, 0]));
    undo.click();
    expect(run).not.toHaveBeenCalled();
    setHistoryButtons(ui, holding([1, 0]));
    undo.click();
    expect(run).toHaveBeenCalledOnce();
  });

  it("still undo a gesture left open when Undo is gray", () => {
    const { undo, ui } = buttons();
    const run = vi.fn();
    let open = true; // a release the canvas never saw left the gesture open
    onHistoryClick(undo, run, () => open);
    setHistoryButtons(ui, holding([0, 0]));
    undo.click();
    expect(run).toHaveBeenCalledOnce();
    open = false;
    undo.click();
    expect(run).toHaveBeenCalledOnce();
  });

  it("leave a page without the buttons alone", () => {
    const ui = { el: { undo: null, redo: null } } as unknown as UI;
    expect(() => setHistoryButtons(ui, holding([1, 1]))).not.toThrow();
    expect(() => onHistoryClick(null, () => {})).not.toThrow();
  });
});

describe("the palette's lock scan", () => {
  // The catalog's `available` decides whether the tower's mode builds a kind,
  // the engine's own rule, so a Modern-only venue stays hidden in Classic at
  // any star and shows in Modern once the star allows it.
  const lockScan = (mode: GameMode, edit: (catalog: Catalog) => Catalog = (c) => c) => {
    const base = catalogFor(mode);
    let catalog = edit(base);
    const palette = document.createElement("div");
    for (const kind of ["foodHall", "office"]) {
      const item = document.createElement("button");
      item.className = "pal-item";
      item.dataset.kind = kind;
      palette.append(item);
    }
    const el = new Proxy({ palette } as Record<string, HTMLElement>, {
      get: (made, key: string) => (made[key] ??= document.createElement("div")),
    });
    const ui = { el, cb: { getCatalog: () => catalog }, paletteCatalog: catalog, paletteScanKey: "", lastLogSeq: 0, tool: { type: "inspect" }, setTowerName: () => {} } as unknown as UI;
    ui.selectTool = (tool) => { ui.tool = tool; };
    const pump = () => update(ui, source({ mode, star: 5, money: 1e9 }).src);
    pump();
    return {
      ui,
      node: (kind: string) => palette.querySelector(`[data-kind="${kind}"]`),
      locked: (kind: string) => palette.querySelector(`[data-kind="${kind}"]`)!.classList.contains("locked"),
      /** Hand the UI a new catalog, then pump again. */
      swap: (next: (catalog: Catalog) => Catalog) => {
        catalog = next(base);
        pump();
      },
    };
  };
  const withoutOffice = (c: Catalog): Catalog => ({ ...c, facilities: c.facilities.map((f) => (f.key === "office" ? { ...f, available: false } : f)) });

  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: the Food Hall is ${mode === "classic" ? "locked" : "unlocked"} at five stars`, () => {
      const { locked } = lockScan(mode);
      expect(locked("foodHall")).toBe(mode === "classic");
      expect(locked("office")).toBe(false);
    });
  }

  it("locks a kind the catalog says the mode does not build, whatever the kind's own flags", () => {
    const { locked } = lockScan("modern", withoutOffice);
    expect(locked("office")).toBe(true);
    expect(locked("foodHall")).toBe(false);
  });

  it("rewrites the locks whenever a new catalog arrives, whether it rebuilds the palette or relabels it", () => {
    const { node, locked, swap } = lockScan("modern");
    // The first swap lays the palette out from the catalog (a rebuild).
    const handMade = node("office");
    swap(withoutOffice);
    expect(node("office")).not.toBe(handMade);
    expect(locked("office")).toBe(true);
    // Later swaps keep the layout, so they relabel the same buttons.
    const office = node("office");
    swap((c) => ({ ...c }));
    expect(node("office")).toBe(office);
    expect(locked("office")).toBe(false);
    swap(withoutOffice);
    expect(node("office")).toBe(office);
    expect(locked("office")).toBe(true);
  });

  it("drops a build tool whose kind a new catalog withholds", () => {
    const { ui, swap } = lockScan("modern");
    swap((c) => ({ ...c }));
    ui.tool = { type: "build", kind: "office" };
    swap(withoutOffice);
    expect(ui.tool).toEqual({ type: "inspect" });
  });
});
