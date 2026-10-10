import { afterEach, describe, expect, it } from "vitest";
import { pgMarkModalPhaseTarget, pgStopModalPhaseWatch, pgWatchModalPhase } from "./screenshotPhaseWatch.ts";

/**
 * Pins the contract of the screenshot dialog phase watch (#762 / #843): the
 * runner tells "not armed" (null, skip the check) apart from "armed but saw
 * nothing" (an empty list, a hard failure) and from a real reading, and only
 * the box being captured counts. A slip in that contract would quietly turn
 * the 27c guard off, so it is checked here, outside the pinned container.
 * The geometry itself (real subpixel positions) only exists in a real
 * browser; happy-dom lays everything out at 0, which is enough for these.
 */
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

function openDialog(): HTMLDialogElement {
  let dlg = document.getElementById("modal") as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "modal";
    document.body.appendChild(dlg);
  }
  const box = document.createElement("div");
  box.className = "modal-box";
  const title = document.createElement("h2");
  title.className = "win-title";
  // The structure finishModal (src/ui/uiModal.ts) leaves: the title text in
  // its own labelled span, the ✕ button beside it inside the heading.
  const label = document.createElement("span");
  label.id = "verticopolis-modal-title";
  label.textContent = "Schedule: Standard Elevator";
  const close = document.createElement("button");
  close.className = "modal-x";
  close.textContent = "✕";
  title.append(label, close);
  box.appendChild(title);
  dlg.replaceChildren(box);
  dlg.setAttribute("open", "");
  return dlg;
}

afterEach(() => {
  pgStopModalPhaseWatch();
  document.body.replaceChildren();
});

describe("screenshot dialog phase watch", () => {
  it("reads null when it was never armed, and again after a stop", () => {
    expect(pgStopModalPhaseWatch()).toBeNull();
    pgWatchModalPhase();
    expect(pgStopModalPhaseWatch()).not.toBeNull();
    expect(pgStopModalPhaseWatch()).toBeNull();
  });

  it("reads an empty list when no frame rendered the open box", () => {
    openDialog();
    pgWatchModalPhase();
    const watch = pgStopModalPhaseWatch();
    expect(watch?.phases).toEqual([]);
    expect(watch?.title).toBe("Schedule: Standard Elevator");
  });

  it("records one phase for a box that holds still across frames", async () => {
    openDialog();
    pgWatchModalPhase();
    await frame();
    await frame();
    expect(pgStopModalPhaseWatch()?.phases).toHaveLength(1);
  });

  it("records a second phase when the box moves by a fraction of a pixel after a frame", async () => {
    const box = openDialog().querySelector(".modal-box") as HTMLElement;
    let left = 360;
    box.getBoundingClientRect = () => new DOMRect(left, 72, 560, 656);
    pgWatchModalPhase();
    await frame();
    left = 365.828125; // 27c's measured move when the edit shrinks the dialog
    await frame();
    expect(pgStopModalPhaseWatch()?.phases).toEqual(["0,0", "828,0"]);
  });

  it("measures phase in device pixels, so a half CSS pixel is whole at DPR 2", async () => {
    const box = openDialog().querySelector(".modal-box") as HTMLElement;
    const dpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    try {
      let left = 11.5;
      box.getBoundingClientRect = () => new DOMRect(left, 75.953125, 366, 692);
      pgWatchModalPhase();
      await frame();
      left = 12; // one device pixel over: same phase
      await frame();
      left = 11.703125; // the phone footer shot's measured x: 23.40625 device px
      await frame();
      expect(pgStopModalPhaseWatch()?.phases).toEqual(["0,906", "406,906"]);
    } finally {
      if (dpr) Object.defineProperty(window, "devicePixelRatio", dpr);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
  });

  it("falls back to the title bar's text without its button when there is no label span", () => {
    const bar = openDialog().querySelector(".win-title")!;
    bar.querySelector("#verticopolis-modal-title")!.replaceWith("Event: Fire");
    pgWatchModalPhase();
    expect(pgStopModalPhaseWatch()?.title).toBe("Event: Fire");
  });

  it("names an open dialog that has no title bar", () => {
    openDialog().querySelector(".win-title")!.remove();
    pgWatchModalPhase();
    expect(pgStopModalPhaseWatch()?.title).toBe("(untitled dialog)");
  });

  it("treats a whole-pixel move as the same phase", async () => {
    const box = openDialog().querySelector(".modal-box") as HTMLElement;
    let top = 72;
    box.getBoundingClientRect = () => new DOMRect(360, top, 560, 656);
    pgWatchModalPhase();
    await frame();
    top = 50;
    await frame();
    expect(pgStopModalPhaseWatch()?.phases).toHaveLength(1);
  });

  it("judges only the box being captured, ignoring one an earlier shot left open", async () => {
    const dlg = openDialog();
    const stale = dlg.querySelector(".modal-box") as HTMLElement;
    stale.getBoundingClientRect = () => new DOMRect(360, 72, 560, 656);
    pgWatchModalPhase();
    await frame();
    const fresh = openDialog().querySelector(".modal-box") as HTMLElement;
    expect(fresh).not.toBe(stale);
    fresh.getBoundingClientRect = () => new DOMRect(365.828125, 72, 548.34375, 656);
    await frame();
    await frame();
    // Two boxes at two phases, but each is judged on its own record.
    expect(pgStopModalPhaseWatch()?.phases).toEqual(["828,0"]);
  });

  it("re-arming retires the earlier recorder and starts a clean record", async () => {
    const box = openDialog().querySelector(".modal-box") as HTMLElement;
    let left = 360;
    box.getBoundingClientRect = () => new DOMRect(left, 72, 560, 656);
    pgWatchModalPhase();
    await frame();
    left = 365.828125;
    pgWatchModalPhase();
    await frame();
    await frame();
    expect(pgStopModalPhaseWatch()?.phases).toEqual(["828,0"]);
  });

  it("judges the marked box and reports it displaced when another dialog replaced it", async () => {
    openDialog();
    pgWatchModalPhase();
    await frame();
    expect(pgMarkModalPhaseTarget()).toBe(true);
    openDialog().querySelector("#verticopolis-modal-title")!.textContent = "Fire!";
    await frame();
    const watch = pgStopModalPhaseWatch();
    expect(watch?.target).toBe("displaced");
    expect(watch?.title).toBe("Schedule: Standard Elevator");
    expect(watch?.phases).toHaveLength(1);
  });

  it("reports a marked dialog that closed before the capture as closed", async () => {
    const dlg = openDialog();
    pgWatchModalPhase();
    await frame();
    expect(pgMarkModalPhaseTarget()).toBe(true);
    dlg.removeAttribute("open");
    const watch = pgStopModalPhaseWatch();
    expect(watch?.target).toBe("closed");
    expect(watch?.title).toBe("Schedule: Standard Elevator");
  });

  it("reports a marked dialog still open as ok", async () => {
    openDialog();
    pgWatchModalPhase();
    await frame();
    pgMarkModalPhaseTarget();
    await frame();
    expect(pgStopModalPhaseWatch()?.target).toBe("ok");
  });

  it("keeps sampling after a sample throws and reports the first error", async () => {
    const box = openDialog().querySelector(".modal-box") as HTMLElement;
    let fail = true;
    box.getBoundingClientRect = () => {
      if (fail) throw new Error("layout exploded");
      return new DOMRect(360, 72, 560, 656);
    };
    pgWatchModalPhase();
    await frame();
    fail = false;
    await frame();
    const watch = pgStopModalPhaseWatch();
    expect(watch?.error).toBe("layout exploded");
    expect(watch?.phases).toEqual(["0,0"]);
  });

  it("cannot mark a target without a running watch or an open dialog", () => {
    openDialog();
    expect(pgMarkModalPhaseTarget()).toBe(false);
    document.getElementById("modal")!.removeAttribute("open");
    pgWatchModalPhase();
    expect(pgMarkModalPhaseTarget()).toBe(false);
  });

  it("samples nothing while the dialog element exists but is closed", async () => {
    openDialog().removeAttribute("open");
    pgWatchModalPhase();
    await frame();
    expect(pgStopModalPhaseWatch()).toEqual({ phases: [], title: "(no open dialog)", target: "unmarked", error: null });
  });

  it("names a missing dialog and samples nothing while the dialog is closed", async () => {
    pgWatchModalPhase();
    await frame();
    expect(pgStopModalPhaseWatch()).toEqual({ phases: [], title: "(no open dialog)", target: "unmarked", error: null });
  });
});
