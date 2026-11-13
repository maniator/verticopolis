import { afterEach, describe, expect, it, vi } from "vitest";
import { fitPalette, PALETTE_FIT, PALETTE_FIT_MQ, refitPalette, watchPaletteFit } from "./paletteFit";

/**
 * jsdom lays nothing out, so each test gives the Tools window a height and a
 * list height per layout. The list height reads the window's classes at the
 * moment the fit measures, which is what a browser does after each class change.
 */
type Heights = { normal: number; compact: number; columns: number; both: number };

function windowWith(clientHeight: number, heights: Heights): HTMLElement {
  const win = document.createElement("aside");
  win.id = "palette";
  Object.defineProperty(win, "clientHeight", { configurable: true, get: () => clientHeight });
  Object.defineProperty(win, "scrollHeight", {
    configurable: true,
    get: () => {
      const compact = win.classList.contains(PALETTE_FIT.compact);
      const columns = win.classList.contains(PALETTE_FIT.columns);
      if (compact && columns) return heights.both;
      if (columns) return heights.columns;
      if (compact) return heights.compact;
      return heights.normal;
    },
  });
  return win;
}

const fitClasses = (win: HTMLElement) => [PALETTE_FIT.compact, PALETTE_FIT.columns].filter((c) => win.classList.contains(c));

// A full Modern list: 1355px of normal rows, 1100 compact, two columns of
// 720 and 600 (heights from a real 1920-wide desktop run).
const MODERN: Heights = { normal: 1355, compact: 1100, columns: 720, both: 600 };

describe("fitPalette", () => {
  it("keeps the normal rows when the whole list already fits", () => {
    const win = windowWith(1400, MODERN);
    expect(fitPalette(win, true)).toEqual([]);
    expect(fitClasses(win)).toEqual([]);
  });

  it("picks compact rows when they are enough", () => {
    const win = windowWith(1150, MODERN);
    expect(fitPalette(win, true)).toEqual([PALETTE_FIT.compact]);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact]);
  });

  it("moves to two columns of normal rows before compact columns", () => {
    const win = windowWith(750, MODERN);
    expect(fitPalette(win, true)).toEqual([PALETTE_FIT.columns]);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.columns]);
  });

  it("uses compact columns when plain columns are still too tall", () => {
    const win = windowWith(650, MODERN);
    expect(fitPalette(win, true)).toEqual([PALETTE_FIT.columns, PALETTE_FIT.compact]);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact, PALETTE_FIT.columns]);
  });

  it("stays on the shortest layout, scrolling, when nothing fits", () => {
    const win = windowWith(400, MODERN);
    expect(fitPalette(win, true)).toEqual([PALETTE_FIT.columns, PALETTE_FIT.compact]);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact, PALETTE_FIT.columns]);
  });

  it("goes back to the normal rows when the window grows", () => {
    let height = 650;
    const win = windowWith(0, MODERN);
    Object.defineProperty(win, "clientHeight", { configurable: true, get: () => height });
    fitPalette(win, true);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact, PALETTE_FIT.columns]);
    height = 1400;
    expect(fitPalette(win, true)).toEqual([]);
    expect(fitClasses(win)).toEqual([]);
  });

  it("clears the fit off the desktop layout, whatever the heights", () => {
    const win = windowWith(400, MODERN);
    fitPalette(win, true);
    expect(fitPalette(win, false)).toEqual([]);
    expect(fitClasses(win)).toEqual([]);
  });

  it("keeps the window's other classes", () => {
    const win = windowWith(650, MODERN);
    win.classList.add("win", "docked");
    fitPalette(win, true);
    expect(win.classList.contains("win")).toBe(true);
    expect(win.classList.contains("docked")).toBe(true);
  });
});

describe("watchPaletteFit", () => {
  type Observer = { callback: ResizeObserverCallback; targets: Element[] };
  let observers: Observer[] = [];
  let mqListeners: (() => void)[] = [];
  let desktop = true;

  function stubPage() {
    observers = [];
    mqListeners = [];
    desktop = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        get matches() {
          return query === PALETTE_FIT_MQ && desktop;
        },
        addEventListener: (_type: string, fn: () => void) => mqListeners.push(fn),
        removeEventListener: () => {},
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        o: Observer;
        constructor(callback: ResizeObserverCallback) {
          this.o = { callback, targets: [] };
          observers.push(this.o);
        }
        observe(target: Element) {
          this.o.targets.push(target);
        }
        disconnect() {}
      },
    );
  }
  const resize = (width: number, height: number) => {
    for (const o of observers) o.callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fits at once, on the desktop query, and observes the window", () => {
    stubPage();
    const win = windowWith(1150, MODERN);
    watchPaletteFit(win);
    expect(window.matchMedia).toHaveBeenCalledWith(PALETTE_FIT_MQ);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact]);
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([win]);
  });

  it("refits when the window's height changes, and not when only its width does", () => {
    stubPage();
    let height = 1150;
    const win = windowWith(0, MODERN);
    Object.defineProperty(win, "clientHeight", { configurable: true, get: () => height });
    watchPaletteFit(win);
    resize(176, 1150);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact]);
    // Shorter: two columns.
    height = 750;
    resize(176, 750);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.columns]);
    // The columns widened the window. A width-only change must not refit, or a
    // window that changed meanwhile would be refitted by its own layout.
    height = 1400;
    resize(340, 750);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.columns]);
    resize(340, 1400);
    expect(fitClasses(win)).toEqual([]);
  });

  it("clears the fit when the viewport leaves the desktop layout, and refits when it returns", () => {
    stubPage();
    const win = windowWith(650, MODERN);
    watchPaletteFit(win);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact, PALETTE_FIT.columns]);
    desktop = false;
    for (const fn of mqListeners) fn();
    expect(fitClasses(win)).toEqual([]);
    desktop = true;
    for (const fn of mqListeners) fn();
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact, PALETTE_FIT.columns]);
  });

  it("watches a window once, and refitPalette refits a watched window on demand", () => {
    stubPage();
    let normal = 1100;
    const win = windowWith(1150, MODERN);
    Object.defineProperty(win, "scrollHeight", {
      configurable: true,
      get: () => (win.classList.contains(PALETTE_FIT.compact) ? 900 : normal),
    });
    const refit = watchPaletteFit(win);
    expect(watchPaletteFit(win)).toBe(refit);
    expect(observers).toHaveLength(1);
    expect(fitClasses(win)).toEqual([]);
    // More tools unlocked: the normal rows no longer fit.
    normal = 1300;
    refitPalette(win);
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact]);
  });

  it("refits when a tool under a folded category is chosen or pointed at, and not for other class changes", async () => {
    stubPage();
    const win = windowWith(1150, MODERN);
    win.innerHTML =
      '<section class="pal-group pal-folded" data-group="Leisure"><div class="pal-item" data-kind="cinema"></div></section>' +
      '<section class="pal-group" data-group="Structure"><div class="pal-item" data-kind="lobby"></div></section>';
    const folded = win.querySelector<HTMLElement>('[data-kind="cinema"]')!;
    const open = win.querySelector<HTMLElement>('[data-kind="lobby"]')!;
    // The list is too tall for normal rows whenever any tool is chosen or
    // pulsed, so a refit at such a moment picks compact rows.
    const shownExtra = () => [folded, open].some((n) => n.classList.contains("active") || n.classList.contains("tt-pulse"));
    Object.defineProperty(win, "scrollHeight", {
      configurable: true,
      get: () => (!win.classList.contains(PALETTE_FIT.compact) && shownExtra() ? 1300 : 1100),
    });
    const settle = () => new Promise<void>((r) => setTimeout(r, 0));
    watchPaletteFit(win);
    expect(fitClasses(win)).toEqual([]);
    // A tool in an open category: its row was already in view, no refit.
    open.classList.add("active");
    await settle();
    expect(fitClasses(win)).toEqual([]);
    open.classList.remove("active");
    // Affordability on a folded tool changes nothing in view.
    folded.classList.add("unaffordable");
    await settle();
    expect(fitClasses(win)).toEqual([]);
    // Choosing the folded tool shows its row: refit.
    folded.classList.add("active");
    await settle();
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact]);
    // Choosing another tool hides it again: refit back.
    folded.classList.remove("active");
    await settle();
    expect(fitClasses(win)).toEqual([]);
    // A Getting Started pointer at it does the same.
    folded.classList.add("tt-pulse");
    await settle();
    expect(fitClasses(win)).toEqual([PALETTE_FIT.compact]);
  });

  it("leaves an unwatched window alone, and accepts none", () => {
    const win = windowWith(400, MODERN);
    refitPalette(win);
    refitPalette(null);
    expect(fitClasses(win)).toEqual([]);
  });
});
