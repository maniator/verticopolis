import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasWebGL, showBootMessage, bootGame, hideBootCover } from "./bootstrap";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { inject as injectWebAnalytics } from "@vercel/analytics";

// The telemetry SDKs are gated on the host and best-effort; stub them so the
// gate and its catch can be asserted without touching the real endpoints.
// The adapter imports both @vercel/analytics symbols (`track` and `inject`) from
// one module, so mock both here even though this file only drives the inject
// path: a partial mock leaves `track` undefined, and any later test reaching the
// send path would throw into the best-effort catch and silently drop the event.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn(), inject: vi.fn() }));
// Mock `virtual:pwa-register` (Vite virtual module via bootstrap.ts/pwa.ts) so the import resolves on Windows too (as pwa.test.ts does).
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));

/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
}

/**
 * Unit tests for the boot entry. Everything runs headlessly under happy-dom:
 * happy-dom's <canvas> returns a null WebGL context, so hasWebGL() is false by
 * default and the true branch is exercised by stubbing document.createElement.
 * bootGame's telemetry is gated on window.location.hostname (localhost by
 * default here, so it is skipped) and registerPWA is real but returns early
 * without a service worker.
 */

describe("hasWebGL", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when getContext yields null (happy-dom default)", () => {
    expect(hasWebGL()).toBe(false);
  });

  it("returns true when a canvas hands back a truthy GL context", () => {
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
      }
      return real(tag);
    });
    expect(hasWebGL()).toBe(true);
  });

  it("returns false when createElement throws", () => {
    vi.spyOn(document, "createElement").mockImplementation(() => {
      throw new Error("no dom");
    });
    expect(hasWebGL()).toBe(false);
  });
});

describe("showBootMessage", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="stage"></div>`;
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("injects the message into #stage", () => {
    showBootMessage("hello boot");
    const stage = document.getElementById("stage")!;
    expect(stage.innerHTML).toContain("hello boot");
    expect(stage.querySelector("button")).toBeNull();
  });

  it("appends a Reload button when withReload is true", () => {
    showBootMessage("reload me", true);
    const stage = document.getElementById("stage")!;
    const btn = stage.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("Reload");
    // Clicking is a no-op for location.reload under happy-dom; just prove the
    // handler is wired and does not throw.
    expect(() => btn!.click()).not.toThrow();
  });

  it("is a no-op when there is no #stage element", () => {
    document.body.innerHTML = "";
    expect(() => showBootMessage("nowhere")).not.toThrow();
  });

  it("removes the boot cover so a fallback message is never trapped behind it", () => {
    document.body.innerHTML = `<div id="boot-cover"></div><div id="stage"></div>`;
    showBootMessage("no WebGL here");
    expect(document.getElementById("boot-cover")).toBeNull();
    expect(document.getElementById("stage")!.innerHTML).toContain("no WebGL here");
  });

  it("overlays a POPULATED stage instead of flowing below its children (live Firefox no-WebGL regression)", () => {
    // The real #stage is never empty: the static canvas and hint fill it, lit
    // appends its part after them, and #stage clips without scrolling, so a
    // statically-positioned message rendered below a full-height canvas sat
    // off-screen and the player saw a dead page with no explanation. Pin the
    // wrapper as an absolute overlay with its own opaque background so stage
    // layout can never push the message out of view again. The fixture leaves
    // #stage WITHOUT position on purpose: establishing the containing block
    // is the function's job now, so CSS drift cannot re-anchor the overlay.
    document.body.innerHTML = `<div id="stage" style="height:600px;overflow:hidden"><canvas id="view" style="display:block;width:100%;height:600px"></canvas><div id="hint">Drag to pan</div></div>`;
    showBootMessage("no WebGL here");
    const wrapper = [...document.querySelectorAll<HTMLElement>("#stage > div")].find((d) =>
      d.textContent?.includes("no WebGL here"),
    );
    expect(wrapper).toBeDefined();
    // Longhand offsets (never the `inset` shorthand): this code path serves
    // old and hardened engines where the shorthand may not parse, which would
    // strand the wrapper at static position and resurrect the bug.
    expect(wrapper!.style.position).toBe("absolute");
    expect(wrapper!.style.top).toBe("0px");
    expect(wrapper!.style.right).toBe("0px");
    expect(wrapper!.style.bottom).toBe("0px");
    expect(wrapper!.style.left).toBe("0px");
    expect(wrapper!.getAttribute("style") ?? "").not.toContain("inset");
    expect(Number(wrapper!.style.zIndex)).toBeGreaterThan(0);
    // An OPAQUE background: the overlay must actually cover the dead canvas.
    expect(wrapper!.style.background || wrapper!.style.backgroundColor).toBe("#1c2030");
    // The containing block is established by the function itself.
    expect(document.getElementById("stage")!.style.position).toBe("relative");
    // The static children survive (lit appends; it must not clobber the app's
    // stage), and the message sits after them in the DOM as the top layer.
    expect(document.getElementById("view")).not.toBeNull();
    expect(document.getElementById("hint")).not.toBeNull();
  });

  it("drops a mounted splash/onboarding so a boot-fallback message is never buried behind them", () => {
    // A boot ERROR can land after runBootFlow mounts the splash (fixed, a
    // higher z-index than the stage-local overlay); the message must own the
    // screen the same way it already owns the boot cover.
    document.body.innerHTML = `<div id="splash"></div><div id="onboard"></div><div id="stage"></div>`;
    showBootMessage("boot failed");
    expect(document.getElementById("splash")).toBeNull();
    expect(document.getElementById("onboard")).toBeNull();
    expect(document.getElementById("stage")!.textContent).toContain("boot failed");
  });
});

describe("hideBootCover", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("removes the cover element when present", () => {
    document.body.innerHTML = `<div id="boot-cover"></div>`;
    hideBootCover();
    expect(document.getElementById("boot-cover")).toBeNull();
  });

  it("is a safe no-op when there is no cover (idempotent across boot outcomes)", () => {
    document.body.innerHTML = "";
    expect(() => hideBootCover()).not.toThrow();
  });
});

describe("bootGame", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
  });

  it("boots immediately when the document is ready (WebGL present)", () => {
    // Stub createElement so hasWebGL() sees a real GL context.
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
      }
      return real(tag);
    });
    const app = { onUpdateAvailable: vi.fn() };
    const create = vi.fn(() => app);

    // readyState is "interactive" under happy-dom (non-loading), so boot runs now.
    expect(document.readyState).not.toBe("loading");
    bootGame(create);

    expect(create).toHaveBeenCalledTimes(1);
    expect((window as unknown as { game: unknown }).game).toBe(app);
  });

  it("shows the no-WebGL message and never calls create when WebGL is missing", () => {
    document.body.innerHTML = `<div id="stage"></div>`;
    // Default happy-dom canvas.getContext returns null, so hasWebGL() is false.
    const create = vi.fn(() => ({ onUpdateAvailable: vi.fn() }));
    bootGame(create);

    expect(create).not.toHaveBeenCalled();
    expect(document.getElementById("stage")!.innerHTML).toContain("can't use WebGL");
    // The remedy copy leads with what to change (acceleration/WebGL), and a
    // real Reload button closes the loop after the setting flips.
    expect(document.getElementById("stage")!.innerHTML).toContain("hardware acceleration");
    const reload = [...document.querySelectorAll("#stage button")].find((b) => b.textContent === "Reload");
    expect(reload).toBeDefined();
    expect((window as unknown as { game?: unknown }).game).toBeUndefined();
  });

  it("shows an error and rethrows when create() throws", () => {
    document.body.innerHTML = `<div id="stage"></div>`;
    stubWebGL(); // localhost host, so telemetry is skipped and boot reaches create()
    const create = vi.fn(() => {
      throw new Error("kaboom");
    });

    expect(() => bootGame(create)).toThrow("kaboom");
    const html = document.getElementById("stage")!.innerHTML;
    expect(html).toContain("Something went wrong");
    expect(html).toContain("kaboom");
  });

  it("defers boot until DOMContentLoaded while the document is still loading", () => {
    stubWebGL();
    const ready = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const app = { onUpdateAvailable: vi.fn() };
    const create = vi.fn(() => app);

    bootGame(create);
    expect(create).not.toHaveBeenCalled(); // parked on the DOMContentLoaded listener

    ready.mockReturnValue("interactive");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("bootGame telemetry gate", () => {
  const localhost = "http://localhost:3000/";

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(injectSpeedInsights).mockReset();
    vi.mocked(injectWebAnalytics).mockReset();
    window.location.href = localhost; // restore host for the rest of the suite
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
  });

  it("injects Vercel telemetry on the production host", () => {
    stubWebGL();
    window.location.href = "https://verticopolis.com/";
    bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));

    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });

  it("injects telemetry on a Vercel preview host too", () => {
    stubWebGL();
    window.location.href = "https://feature-branch.vercel.app/";
    bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));

    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });

  it("skips telemetry on any other host", () => {
    stubWebGL();
    window.location.href = localhost;
    bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));

    expect(injectSpeedInsights).not.toHaveBeenCalled();
    expect(injectWebAnalytics).not.toHaveBeenCalled();
  });

  it("never lets a telemetry failure block boot", () => {
    stubWebGL();
    window.location.href = "https://verticopolis.com/";
    vi.mocked(injectSpeedInsights).mockImplementationOnce(() => {
      throw new Error("telemetry down");
    });
    const app = { onUpdateAvailable: vi.fn() };

    expect(() => bootGame(vi.fn(() => app))).not.toThrow();
    // Boot still finished: the game handle is published despite the telemetry throw.
    expect((window as unknown as { game?: unknown }).game).toBe(app);
  });
});
