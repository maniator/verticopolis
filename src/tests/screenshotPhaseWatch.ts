/**
 * The screenshot dialog phase watch (#762 / #843), shared by the generator
 * (re-exported from scripts/screenshot-page-ops.ts) and its contract test.
 * It lives here, beside screenshotOnlyFilter.ts, so the unit test can import
 * it without reaching outside src/.
 *
 * ⚠ BROWSER-INJECTED CODE. Every function here (the watch, the target
 * mark, the stop) is shipped into the page by Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so each must stay fully
 * self-contained: no imports used inside, and no references to module-scope
 * values or to each other. Keep this file ERASABLE (type annotations and
 * `as` only).
 */

/** Start recording the subpixel phases (the fractional part of the left and
 *  top edges, in device pixels) of each open `#modal .modal-box` and of every
 *  `position: sticky` element inside it, on every frame the page renders, for
 *  `pgStopModalPhaseWatch` to read back. The sticky elements are the layers
 *  whose raster is at stake; the box is sampled too so a dialog with no
 *  sticky content is still watched. The sticky set is taken from the box's
 *  first sampled frame; other composited layers, and sticky layers added or
 *  removed later, are not covered, which #889 tracks (a set member that a
 *  re-render detaches makes the set be found again). Phases are kept per
 *  box ELEMENT: every open builds a fresh box, so a box left open by an
 *  earlier shot (`keepDialogs`) is never mistaken for the one being
 *  captured. Runs in the browser.
 *
 *  Why the phases have to hold still (the #762 / #843 leak, measured on 27c):
 *  the dialog's sticky layers (the title bar, the schedule grid head) are
 *  composited, and Chromium rasters a composited layer at the subpixel phase
 *  it had when that raster was made, then keeps reusing it when the layer
 *  later moves. A dialog that renders at one phase and then moves by a
 *  fraction of a pixel (27c's shrinks from 560px to 548.34px wide on the
 *  edit, moving from x=360 to x=365.83) captures its sticky text at whichever
 *  phase the first raster happened to land on, and whether a frame rendered
 *  before the move is a race against the compositor. A whole-pixel move (a
 *  sticky layer pinning as the box scrolls) keeps the phase and is harmless.
 *
 *  The watch is a tripwire, so it fires only on a run where the move
 *  actually happened after a rendered frame. A staging change that
 *  reintroduces the race fails some runs and passes others, the way the
 *  original flake did, but every failure names the cause. The sample is
 *  taken in requestAnimationFrame, just before that frame's style and
 *  layout, so it reads the geometry the frame is about to render unless a
 *  later callback in the same frame moves the box. */
export function pgWatchModalPhase(): void {
  type Rec = {
    boxes: Map<Element, string[]>;
    layers: Map<Element, Element[]>;
    target: Element | null;
    stopped: boolean;
    error: string | null;
  };
  const w = window as unknown as { __vcModalPhase?: Rec };
  if (w.__vcModalPhase) w.__vcModalPhase.stopped = true;
  const rec: Rec = { boxes: new Map(), layers: new Map(), target: null, stopped: false, error: null };
  w.__vcModalPhase = rec;
  const sample = (): void => {
    const dlg = document.getElementById("modal") as HTMLDialogElement | null;
    const box = dlg?.open ? dlg.querySelector(".modal-box") : null;
    if (box) {
      const dpr = window.devicePixelRatio || 1;
      // Thousandths of a device pixel, wrapped so 0.9999 and 0 read the same.
      const phase = (v: number): number => Math.round((v * dpr - Math.floor(v * dpr)) * 1000) % 1000;
      // The sticky set is found once per box, so the per-frame work is just
      // the rect reads (which the next frame's layout needs anyway).
      // A layer a re-render detached would read as a 0,0 rect, a false phase,
      // so a detached member makes the set be found again.
      let layers = rec.layers.get(box);
      if (!layers || layers.some((el) => !el.isConnected)) {
        layers = [box, ...Array.from(box.querySelectorAll("*")).filter((el) => getComputedStyle(el).position === "sticky")];
        rec.layers.set(box, layers);
      }
      const p = layers
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${phase(r.left)},${phase(r.top)}`;
        })
        .join(" ");
      const seen = rec.boxes.get(box) ?? [];
      if (!seen.includes(p)) seen.push(p);
      rec.boxes.set(box, seen);
    }
  };
  const tick = (): void => {
    if (rec.stopped) return;
    // A sample that throws must not end the loop silently, which would let
    // the shot pass unwatched: keep the first error for the stop to report.
    try {
      sample();
    } catch (e) {
      rec.error ??= e instanceof Error ? e.message : String(e);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Mark the currently open `#modal .modal-box` as the one the running watch
 *  must judge, once the shot's setup has staged it. `pgStopModalPhaseWatch`
 *  then reports it as displaced if a different dialog is open at capture
 *  time (an event modal the running sim popped during the settle), so the
 *  watch can never pass by judging the wrong dialog. Returns whether there
 *  was both a running watch and an open box to mark. Runs in the browser. */
export function pgMarkModalPhaseTarget(): boolean {
  const w = window as unknown as { __vcModalPhase?: { target: Element | null } };
  const rec = w.__vcModalPhase;
  const dlg = document.getElementById("modal") as HTMLDialogElement | null;
  const box = dlg?.open ? dlg.querySelector(".modal-box") : null;
  if (!rec || !box) return false;
  rec.target = box;
  return true;
}

/** Stop the `pgWatchModalPhase` recorder and report on the box it should
 *  judge (the marked target, else the box open now), or null when no
 *  recorder was running. `phases` lists every distinct sample (`"x,y"` per
 *  layer, box first, in thousandths of a device pixel); a capture is
 *  phase-stable only when it holds exactly one, and an empty list means no
 *  frame rendered that box, so nothing was checked. `target` says what
 *  became of the marked box: still open (`ok`), replaced by another dialog
 *  (`displaced`), no dialog open (`closed`), or none was marked (`unmarked`).
 *  `title` names the judged box (its title bar text) so a failure says which
 *  dialog it judged, and `error` carries the first sample that threw.
 *  Idempotent: a second call returns null. Runs in the browser. */
export function pgStopModalPhaseWatch(): {
  phases: string[];
  title: string;
  target: "ok" | "displaced" | "closed" | "unmarked";
  error: string | null;
} | null {
  const w = window as unknown as {
    __vcModalPhase?: { boxes: Map<Element, string[]>; target: Element | null; stopped: boolean; error: string | null };
  };
  const rec = w.__vcModalPhase;
  if (!rec) return null;
  rec.stopped = true;
  delete w.__vcModalPhase;
  const dlg = document.getElementById("modal") as HTMLDialogElement | null;
  const open = dlg?.open ? dlg.querySelector(".modal-box") : null;
  const box = rec.target ?? open;
  // The title text without its ✕: finishModal (src/ui/uiModal.ts) moves the
  // heading's content into #verticopolis-modal-title beside the button; a
  // bar built any other way falls back to its text minus the button's.
  const bar = box?.querySelector(".win-title");
  const label = bar?.querySelector("#verticopolis-modal-title");
  const button = bar?.querySelector("button");
  const text = (label ? label.textContent ?? "" : (bar?.textContent ?? "").replace(button?.textContent ?? "", "")).trim();
  const title = box ? text || "(untitled dialog)" : "(no open dialog)";
  let target: "ok" | "displaced" | "closed" | "unmarked" = "ok";
  if (!rec.target) target = "unmarked";
  else if (!open) target = "closed";
  else if (rec.target !== open) target = "displaced";
  return { phases: (box && rec.boxes.get(box)) || [], title, target, error: rec.error };
}
