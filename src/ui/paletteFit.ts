/**
 * Desktop fit for the Tools window (`#palette`). A Modern tower with every
 * venue unlocked lists about forty tools under eleven headers, which is taller
 * than most desktop windows, so the list used to scroll. On the desktop layout
 * the window now tries a few layouts in order and keeps the first one that
 * shows every tool without a scrollbar:
 *
 *   1. the normal rows;
 *   2. compact rows (less padding, tighter headers);
 *   3. two columns of normal rows (the window widens);
 *   4. two columns of compact rows.
 *
 * When even the last one is too tall (a very short window), it stays on the
 * last one, the shortest, and the window scrolls as before. Phones, sideways
 * phones and tablets lay the palette out their own way (category tabs, a
 * strip, touch-size rows), so the fit leaves them alone: their media blocks
 * all sit below {@link PALETTE_FIT_MQ}, and the fit classes are cleared there.
 *
 * The fit reads layout (scroll height against the window's height), so it runs
 * only when the answer can change: when the lock scan shows or hides a tool,
 * when the window's height changes, when the viewport crosses into or out of
 * the desktop layout, when a tool under a folded category starts or stops
 * showing (the chosen tool and a Getting Started pointer stay in view), and
 * once the page's fonts are ready. Never per frame.
 */

import { PALETTE_FOLDED_CLASS } from "./paletteSections";

/** The desktop layout: every viewport at least this wide docks the palette as
 *  a plain vertical list. The phone, landscape-phone and tablet media blocks
 *  all cap at 1023px wide. Mirrored by the fit rules in tools-stage.css. */
export const PALETTE_FIT_MQ = "(min-width: 1024px)";

/** The fit's layout classes on the `#palette` window. */
export const PALETTE_FIT = {
  /** Tighter rows and headers. */
  compact: "pal-fit-compact",
  /** The build categories flow into two columns. */
  columns: "pal-fit-columns",
} as const;

type FitClass = (typeof PALETTE_FIT)[keyof typeof PALETTE_FIT];

/** The layouts to try, in order of preference: the first that fits is kept. */
const FIT_STEPS: readonly (readonly FitClass[])[] = [
  [],
  [PALETTE_FIT.compact],
  [PALETTE_FIT.columns],
  [PALETTE_FIT.columns, PALETTE_FIT.compact],
];

const ALL_FIT_CLASSES: readonly FitClass[] = [PALETTE_FIT.compact, PALETTE_FIT.columns];

/** True when the window shows its whole list without scrolling. */
function showsEverything(win: HTMLElement): boolean {
  return win.scrollHeight <= win.clientHeight;
}

/**
 * Pick the Tools window's layout. `desktop` is whether the desktop layout is in
 * force ({@link PALETTE_FIT_MQ}); off it, the fit classes are removed. The
 * steps run synchronously, so the browser paints only the final choice.
 * Returns the classes it kept, for the caller's tests.
 */
export function fitPalette(win: HTMLElement, desktop: boolean): readonly FitClass[] {
  win.classList.remove(...ALL_FIT_CLASSES);
  if (!desktop) return [];
  let kept: readonly FitClass[] = [];
  for (const step of FIT_STEPS) {
    win.classList.remove(...ALL_FIT_CLASSES);
    win.classList.add(...step);
    kept = step;
    if (showsEverything(win)) break;
  }
  return kept;
}

/** The classes that keep a tool in view under a folded category (the CSS
 *  hides a folded category's other tools): the chosen tool and the tool
 *  Getting Started points at. */
const SHOWN_WHEN_FOLDED = ["active", "tt-pulse"] as const;

function showsWhenFolded(classes: readonly string[]): boolean {
  return SHOWN_WHEN_FOLDED.some((c) => classes.includes(c));
}

/** Whether a class change on a tool showed or hid it under a folded category. */
export function changesFoldedRows(record: MutationRecord): boolean {
  const item = record.target;
  if (!(item instanceof HTMLElement) || !item.classList.contains("pal-item")) return false;
  if (!item.closest(`.${PALETTE_FOLDED_CLASS}`)) return false;
  const before = (record.oldValue ?? "").split(/\s+/);
  return showsWhenFolded(before) !== showsWhenFolded([...item.classList]);
}

type FitWatch = { refit: () => void };
const watches = new WeakMap<HTMLElement, FitWatch>();

/**
 * Keep `win` fitted while the page runs: refit when the window's height
 * changes (a resize, the top bar wrapping), when the viewport crosses the
 * desktop breakpoint, when a tool under a folded category is chosen or
 * pointed at, and once the page's fonts are ready (the game uses system
 * fonts today, so this only guards a font that loads late). Watching the same
 * window twice reuses the first watch. Returns the refit function, which the
 * lock scan also calls when it shows or hides tools.
 */
export function watchPaletteFit(win: HTMLElement): () => void {
  const existing = watches.get(win);
  if (existing) return existing.refit;
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(PALETTE_FIT_MQ) : null;
  const refit = () => {
    fitPalette(win, mq?.matches ?? false);
  };
  watches.set(win, { refit });
  mq?.addEventListener("change", refit);
  if (typeof ResizeObserver === "function") {
    // Only a height change can change the answer. The fit itself changes the
    // window's width (two columns), so a width change must not refit, or the
    // observer would chase its own layout.
    let lastHeight = -1;
    new ResizeObserver((entries) => {
      const height = Math.round(entries[entries.length - 1].contentRect.height);
      if (height === lastHeight) return;
      lastHeight = height;
      refit();
    }).observe(win);
  }
  if (typeof MutationObserver === "function") {
    // Choosing a tool, or a Getting Started pointer, shows one more row under a
    // folded category, and nothing else changes the window's box. Class changes
    // on tools are rare (the lock scan toggles only on a change), and each
    // record is a few class checks.
    new MutationObserver((records) => {
      if (records.some(changesFoldedRows)) refit();
    }).observe(win, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  }
  void document.fonts?.ready.then(refit);
  refit();
  return refit;
}

/** Refit a watched window now (the lock scan calls this after it shows or
 *  hides tools). A window nobody watches is left alone. */
export function refitPalette(win: HTMLElement | null): void {
  if (win) watches.get(win)?.refit();
}
