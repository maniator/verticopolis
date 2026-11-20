import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ctxDouble } from "./saverTestKit.fixture";
import { GRACE_MS, MOVE_PX, SAVER_HINT, SWALLOW_MS, runScene, showScreenSaver } from "./screenSaver";

function scene() {
  return { step: vi.fn(), draw: vi.fn() };
}

describe("the screen saver overlay", () => {
  let ends: Array<() => void> = [];
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctxDouble() as unknown as CanvasRenderingContext2D,
    );
  });
  afterEach(() => {
    // End every saver a test left up, and let its swallow window pass, so
    // no listener outlives its test.
    for (const end of ends) end();
    ends = [];
    vi.advanceTimersByTime(SWALLOW_MS);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function open(still = false) {
    const s = scene();
    const onEnd = vi.fn();
    const makeScene = vi.fn(() => s);
    const end = showScreenSaver({ makeScene, still, onEnd });
    ends.push(end);
    return { s, onEnd, makeScene, end };
  }

  it("covers the window with a labeled dialog and a hint, and draws the scene", () => {
    const { s, makeScene } = open();
    const root = document.getElementById("screensaver")!;
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-modal")).toBe("true");
    expect(root.querySelector(".screensaver-hint")?.textContent).toBe(SAVER_HINT);
    expect(document.activeElement).toBe(root);
    expect(makeScene).toHaveBeenCalledTimes(1);
    expect(s.draw).toHaveBeenCalledTimes(1);
  });

  it("ignores input in the grace time, then ends on a key and keeps it from the game", () => {
    const { onEnd } = open();
    const game = vi.fn();
    window.addEventListener("keydown", game);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GRACE_MS);
    const key = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    window.dispatchEvent(key);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(key.defaultPrevented).toBe(true);
    expect(game).not.toHaveBeenCalled();
    expect(document.getElementById("screensaver")).toBeNull();
    window.removeEventListener("keydown", game);
  });

  it("swallows the click that follows the ending press, then lets clicks through", () => {
    open();
    vi.advanceTimersByTime(GRACE_MS);
    window.dispatchEvent(new Event("pointerdown", { cancelable: true }));
    const game = vi.fn();
    window.addEventListener("click", game);
    window.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    expect(game).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SWALLOW_MS);
    window.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    expect(game).toHaveBeenCalledTimes(1);
    window.removeEventListener("click", game);
  });

  it("ends on a mouse move past the threshold, never on a drift or a touch move", () => {
    const { onEnd } = open();
    vi.advanceTimersByTime(GRACE_MS);
    const move = (x: number, pointerType = "mouse") => {
      const e = new Event("pointermove", { cancelable: true }) as Event & {
        clientX: number;
        clientY: number;
        pointerType: string;
      };
      Object.assign(e, { clientX: x, clientY: 0, pointerType });
      window.dispatchEvent(e);
    };
    move(0);
    move(MOVE_PX);
    move(100, "touch");
    expect(onEnd).not.toHaveBeenCalled();
    move(MOVE_PX + 1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("runs onEnd once whether the player or the caller ends it", () => {
    const { onEnd, end } = open();
    end();
    end();
    vi.advanceTimersByTime(GRACE_MS);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("draws at most 30 frames a second", () => {
    const { s } = open();
    vi.advanceTimersByTime(1000);
    expect(s.draw.mock.calls.length).toBeGreaterThan(20);
    expect(s.draw.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it("holds one still frame for reduced motion, run a few seconds ahead", () => {
    const { s } = open(true);
    expect(s.step.mock.calls.length).toBeGreaterThan(30);
    expect(s.draw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(s.draw).toHaveBeenCalledTimes(1);
  });
});

describe("runScene", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops drawing once its canvas leaves the page", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctxDouble() as unknown as CanvasRenderingContext2D,
    );
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const s = scene();
    runScene(canvas, s, false);
    vi.advanceTimersByTime(200);
    const drawn = s.draw.mock.calls.length;
    expect(drawn).toBeGreaterThan(1);
    canvas.remove();
    vi.advanceTimersByTime(1000);
    expect(s.draw.mock.calls.length).toBe(drawn);
    expect(vi.getTimerCount()).toBe(0);
  });
});
