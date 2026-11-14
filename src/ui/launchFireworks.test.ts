import { describe, it, expect, vi, afterEach } from "vitest";
import { render, type TemplateResult } from "lit-html";
import { renderToFragment } from "./testing/litTestUtils";
import { WELCOME_LINKS, welcomeModalTemplate } from "./templates/welcome";
import {
  LAUNCH_FIREWORKS_SEEN_KEY,
  MAX_SPARKS,
  SPARKS_PER_BURST,
  LAUNCH_WINDOW_MS,
  burst,
  drawSky,
  majorOf,
  maybeLaunchFireworks,
  newSky,
  shouldPlayLaunchFireworks,
  showLaunchFireworks,
  stepSky,
  stillSky,
  type LaunchFireworksGate,
} from "./launchFireworks";

/** A storage double: a map behind spied getItem/setItem. */
function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  };
}

function gate(over: Partial<LaunchFireworksGate> = {}): LaunchFireworksGate {
  const storage = memoryStorage();
  return { version: "4.0.0", automated: false, forced: false, storage: () => storage, ...over };
}

describe("the version helper", () => {
  it("reads the major number, and NaN for a dev build", () => {
    expect(majorOf("4.0.0")).toBe(4);
    expect(majorOf("12.3.4")).toBe(12);
    expect(majorOf("dev")).toBeNaN();
  });
});

describe("whether the fireworks play", () => {
  it("plays once on a 4.x build, then latches", () => {
    const storage = memoryStorage();
    const g = gate({ storage: () => storage });
    expect(shouldPlayLaunchFireworks(g)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(LAUNCH_FIREWORKS_SEEN_KEY, "1");
    expect(shouldPlayLaunchFireworks(g)).toBe(false);
  });

  it("stays quiet where the latch is already set", () => {
    const storage = memoryStorage({ [LAUNCH_FIREWORKS_SEEN_KEY]: "1" });
    expect(shouldPlayLaunchFireworks(gate({ storage: () => storage }))).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["3.12.3", "5.0.0", "dev"])("never plays on %s, and leaves the latch for 4.x", (version) => {
    const storage = memoryStorage();
    expect(shouldPlayLaunchFireworks(gate({ version, storage: () => storage }))).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("never plays under browser automation, so screenshots and e2e runs stay clean", () => {
    const storage = memoryStorage();
    expect(shouldPlayLaunchFireworks(gate({ automated: true, storage: () => storage }))).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("skips the show when storage is blocked, since it could not latch", () => {
    const blocked = () => {
      throw new Error("SecurityError");
    };
    expect(shouldPlayLaunchFireworks(gate({ storage: blocked }))).toBe(false);
    const throwsOnWrite = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(shouldPlayLaunchFireworks(gate({ storage: () => throwsOnWrite }))).toBe(false);
  });

  it("plays a forced preview on any version, under automation, without touching the latch", () => {
    const storage = memoryStorage({ [LAUNCH_FIREWORKS_SEEN_KEY]: "1" });
    expect(shouldPlayLaunchFireworks(gate({ version: "3.12.3", automated: true, forced: true, storage: () => storage }))).toBe(true);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("the sky", () => {
  it("sends up a rocket, bursts it at its height and lets the sparks die out", () => {
    const sky = newSky(200, 100);
    stepSky(sky, 16, () => 0.5);
    expect(sky.rockets).toHaveLength(1);
    // Keep stepping past the launch window until the sky is empty again.
    let sawSparks = false;
    for (let i = 0; i < 1000 && (sky.elapsedMs < LAUNCH_WINDOW_MS || sky.rockets.length || sky.sparks.length); i++) {
      stepSky(sky, 50, () => 0.5);
      if (sky.sparks.length) sawSparks = true;
    }
    expect(sawSparks).toBe(true);
    expect(sky.rockets).toHaveLength(0);
    expect(sky.sparks).toHaveLength(0);
  });

  it("launches no rockets after the launch window", () => {
    const sky = newSky(200, 100);
    sky.elapsedMs = LAUNCH_WINDOW_MS + 1;
    stepSky(sky, 50, () => 0.5);
    expect(sky.rockets).toHaveLength(0);
  });

  it("clamps a long stall to one short step", () => {
    const sky = newSky(200, 100);
    stepSky(sky, 10_000, () => 0.5);
    expect(sky.elapsedMs).toBeLessThanOrEqual(50);
  });

  it("caps the live sparks", () => {
    const sky = newSky(200, 100);
    const bursts = Math.ceil(MAX_SPARKS / SPARKS_PER_BURST) + 3;
    for (let i = 0; i < bursts; i++) burst(sky, 100, 50, "#ffffff", () => 0.5);
    expect(sky.sparks).toHaveLength(MAX_SPARKS);
  });

  it("lays out a still frame of four full bursts for reduced motion", () => {
    const sky = stillSky(200, 100);
    expect(sky.sparks).toHaveLength(4 * SPARKS_PER_BURST);
    expect(sky.rockets).toHaveLength(0);
  });

  it("paints one pixel per spark and per rocket", () => {
    const sky = newSky(200, 100);
    burst(sky, 100, 50, "#ffc94a", () => 0.5);
    sky.rockets.push({ x: 10, y: 90, vy: -50, burstY: 20, color: "#50e0ff" });
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "", globalAlpha: 1 };
    drawSky(ctx as unknown as CanvasRenderingContext2D, sky);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(ctx.fillRect).toHaveBeenCalledTimes(SPARKS_PER_BURST + 1);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe("the show", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById("test-modal")?.remove();
  });

  /** A canvas context double, so the frame loop runs under the test DOM. */
  function stubCanvas() {
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "", globalAlpha: 1, imageSmoothingEnabled: true };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    return ctx;
  }

  /** The UI's two modal primitives as spies. Opening renders the template into
   *  a box inside a dialog, as `UI.openModalTemplate` does; closing empties
   *  the dialog, as `UI.closeModal` does. */
  function modalPort() {
    const dialog = document.createElement("dialog");
    dialog.id = "test-modal";
    document.body.append(dialog);
    const box = document.createElement("div");
    const ui = {
      openModalTemplate: vi.fn((result: TemplateResult, _opts?: { displaceable?: boolean }) => {
        render(result, box);
        dialog.append(box);
        return box;
      }),
      wireActions: vi.fn(),
    };
    return { ui, dialog, box, close: () => dialog.replaceChildren() };
  }

  it("opens the welcome in the shared modal, displaceable, with its actions wired", () => {
    stubCanvas();
    const { ui, box } = modalPort();
    showLaunchFireworks({ ui, reducedMotion: true, raf: vi.fn() });
    expect(ui.openModalTemplate).toHaveBeenCalledTimes(1);
    expect(ui.openModalTemplate.mock.calls[0]![1]).toEqual({ displaceable: true });
    expect(ui.wireActions).toHaveBeenCalledWith(box);
    expect(box.querySelector(":scope > h2")!.textContent).toBe("Welcome to Verticopolis™");
  });

  it("puts the fireworks canvas inside the dialog, ahead of the window's box", () => {
    stubCanvas();
    const { ui, dialog, box } = modalPort();
    showLaunchFireworks({ ui, reducedMotion: true, raf: vi.fn() });
    const canvas = dialog.firstElementChild as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.className).toBe("launch-fireworks-sky");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.nextElementSibling).toBe(box);
  });

  it("with reduced motion, paints one still frame and starts no frame loop", () => {
    const ctx = stubCanvas();
    const raf = vi.fn();
    showLaunchFireworks({ ui: modalPort().ui, reducedMotion: true, raf });
    expect(raf).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledTimes(4 * SPARKS_PER_BURST);
  });

  it("animates frame after frame with motion on", () => {
    const ctx = stubCanvas();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => frames.push(cb));
    showLaunchFireworks({ ui: modalPort().ui, reducedMotion: false, rand: () => 0.5, raf });
    frames[0]!(0);
    frames[1]!(16);
    expect(raf).toHaveBeenCalledTimes(3);
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).toHaveBeenCalled(); // the first rocket
  });

  it("stops its frame loop when the dialog closes and takes the canvas", () => {
    const ctx = stubCanvas();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => frames.push(cb));
    const port = modalPort();
    showLaunchFireworks({ ui: port.ui, reducedMotion: false, rand: () => 0.5, raf });
    frames[0]!(0);
    port.close();
    frames[1]!(16);
    expect(raf).toHaveBeenCalledTimes(2);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
  });

  it("stops asking for frames once the last spark is gone", () => {
    stubCanvas();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => frames.push(cb));
    showLaunchFireworks({ ui: modalPort().ui, reducedMotion: false, rand: () => 0.5, raf });
    let now = 0;
    for (let i = 0; i < 1000 && frames.length === i + 1; i++) {
      frames[i]!(now);
      now += 50;
    }
    const asked = raf.mock.calls.length;
    expect(asked).toBeGreaterThan(LAUNCH_WINDOW_MS / 50);
    expect(asked).toBeLessThan(1000);
  });
});

describe("the welcome window", () => {
  it("greets without a version and offers OK as the standard primary action", () => {
    const frag = renderToFragment(welcomeModalTemplate());
    expect(frag.querySelector("h2")!.textContent).toBe("Welcome to Verticopolis™");
    expect(frag.textContent).not.toMatch(/\d\.\d/);
    const ok = frag.querySelector<HTMLButtonElement>(".modal-actions > .btn.primary")!;
    expect(ok.textContent).toBe("OK");
    expect(ok.dataset.act).toBe("close");
    expect(ok.hasAttribute("autofocus")).toBe(true);
  });

  it("offers first-time help links that open in a new tab, marked as opened by the game", () => {
    const frag = renderToFragment(welcomeModalTemplate());
    const links = [...frag.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((a) => a.textContent!.replace(" (opens in a new tab)", "").trim())).toEqual([
      WELCOME_LINKS.firstTower.label,
      WELCOME_LINKS.modes.label,
      WELCOME_LINKS.whatsNew.label,
    ]);
    const urls = links.map((a) => new URL(a.getAttribute("href")!, "https://example.test"));
    expect(urls.map((u) => u.pathname)).toEqual([WELCOME_LINKS.firstTower.href, WELCOME_LINKS.modes.href, WELCOME_LINKS.whatsNew.href]);
    for (const [i, a] of links.entries()) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
      expect(urls[i]!.searchParams.get("from")).toBe("game");
    }
  });
});

describe("the boot call", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, "", "/");
  });

  const port = () => ({ openModalTemplate: vi.fn(() => document.createElement("div")), wireActions: vi.fn() });

  it("plays the preview `?debug=fireworks` asks for, reading reduced motion then", () => {
    history.replaceState(null, "", "/?debug=fireworks");
    const ui = port();
    const reducedMotion = vi.fn(() => true);
    maybeLaunchFireworks(ui, reducedMotion);
    expect(ui.openModalTemplate).toHaveBeenCalledTimes(1);
    expect(reducedMotion).toHaveBeenCalledTimes(1);
  });

  it("skips a boot whose save could not be read, leaving the latch for a later one", () => {
    history.replaceState(null, "", "/?debug=fireworks");
    const ui = port();
    const reducedMotion = vi.fn(() => true);
    maybeLaunchFireworks(ui, reducedMotion, true);
    expect(ui.openModalTemplate).not.toHaveBeenCalled();
    expect(reducedMotion).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAUNCH_FIREWORKS_SEEN_KEY)).toBeNull();
  });

  it("stays quiet once it has played on this profile, without reading reduced motion", () => {
    // The latch silences it on any build: a 3.x build by version, a 4.x one by the latch.
    localStorage.setItem(LAUNCH_FIREWORKS_SEEN_KEY, "1");
    const ui = port();
    const reducedMotion = vi.fn(() => true);
    maybeLaunchFireworks(ui, reducedMotion);
    expect(ui.openModalTemplate).not.toHaveBeenCalled();
    expect(reducedMotion).not.toHaveBeenCalled();
    localStorage.removeItem(LAUNCH_FIREWORKS_SEEN_KEY);
  });
});
