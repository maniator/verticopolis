// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BAR_SHOWING_CLASS, BRIDGE_PATH, bridgeHelpBar, linkToGame, startHelpBar, stateText, type GameLink } from "./helpBar";
import { GONE_AFTER_MS, HELLO_EVERY_MS, type BarChannel, type GameStatus } from "./helpBarProtocol";

const STATUS: GameStatus = {
  game: "status",
  speed: 0,
  heldForHelp: true,
  visible: false,
  hud: { date: "Wed, 1st WD", time: "9:00 AM", money: "$1,000", population: "120", stars: "★★☆☆☆" },
};

/** The bar's markup, as HelpBar.astro writes it. */
function mountBar(): HTMLElement {
  document.body.innerHTML = `
    <section id="vc-help-bar" hidden>
      <p><span data-hud="date"></span> <span data-hud="time"></span> <span data-hud="money"></span> <span data-hud="population"></span> <span data-hud="stars"></span></p>
      <p role="status" data-bar-state></p>
      <button type="button" data-bar="run">Keep my tower running</button>
      <button type="button" data-bar="pause" hidden>Pause it</button>
      <a data-bar="back" href="/">Back to game</a>
    </section>`;
  return document.getElementById("vc-help-bar")!;
}

/** The bar on a fake link and fake timers. */
function bar() {
  const root = mountBar();
  const sent: string[] = [];
  const link: GameLink = { send: vi.fn((r) => sent.push(r)), onStatus: null };
  let hello: (() => void) | null = null;
  let gone: (() => void) | null = null;
  const deps = {
    link,
    backToGame: vi.fn((e: MouseEvent) => e.preventDefault()),
    track: vi.fn(),
    setInterval: vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(HELLO_EVERY_MS);
      hello = fn;
    }),
    setTimeout: vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(GONE_AFTER_MS);
      gone = fn;
      return fn;
    }),
    clearTimeout: vi.fn(),
  };
  startHelpBar(root, deps);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  return {
    root,
    sent,
    deps,
    say: (s: Partial<GameStatus> = {}) => link.onStatus!({ ...STATUS, ...s }),
    hello: () => hello!(),
    goQuiet: () => gone!(),
    run: q<HTMLButtonElement>('button[data-bar="run"]'),
    pause: q<HTMLButtonElement>('button[data-bar="pause"]'),
    back: q<HTMLAnchorElement>('a[data-bar="back"]'),
    state: q<HTMLElement>("[data-bar-state]"),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.classList.remove(BAR_SHOWING_CLASS);
  vi.restoreAllMocks();
});

describe("the Help bar's words", () => {
  it("never claims a hidden tab runs", () => {
    expect(stateText({ speed: 0, heldForHelp: true, visible: false })).toBe("Paused while you read.");
    expect(stateText({ speed: 0, heldForHelp: false, visible: true })).toBe("Paused.");
    expect(stateText({ speed: 2, heldForHelp: false, visible: true })).toBe("Running.");
    expect(stateText({ speed: 2, heldForHelp: false, visible: false })).toBe("Your tower will run when you can see it.");
  });
});

describe("the Help bar", () => {
  it("says hello at once and every few seconds, and stays hidden until the game answers", () => {
    const b = bar();
    expect(b.sent).toEqual(["hello"]);
    b.hello();
    expect(b.sent).toEqual(["hello", "hello"]);
    expect(b.root.hidden).toBe(true);
    expect(document.documentElement.classList.contains(BAR_SHOWING_CLASS)).toBe(false);
  });

  it("shows the game's HUD and state on its answer", () => {
    const b = bar();
    b.say();
    expect(b.root.hidden).toBe(false);
    expect(document.documentElement.classList.contains(BAR_SHOWING_CLASS)).toBe(true);
    expect(b.root.querySelector('[data-hud="money"]')!.textContent).toBe("$1,000");
    expect(b.root.querySelector('[data-hud="stars"]')!.textContent).toBe("★★☆☆☆");
    expect(b.state.textContent).toBe("Paused while you read.");
    expect(b.run.hidden).toBe(false);
    expect(b.pause.hidden).toBe(true);
  });

  it("hides when the game goes quiet, and comes back with its next answer", () => {
    const b = bar();
    b.say();
    b.goQuiet();
    expect(b.root.hidden).toBe(true);
    expect(document.documentElement.classList.contains(BAR_SHOWING_CLASS)).toBe(false);
    b.say();
    expect(b.root.hidden).toBe(false);
    // Each answer pushes the quiet timer back.
    expect(b.deps.clearTimeout).toHaveBeenCalled();
  });

  it("asks the game to run, then offers Pause it with the focus moved to it", () => {
    const b = bar();
    b.say();
    b.run.focus();
    b.run.click();
    expect(b.sent[b.sent.length - 1]).toBe("run");
    expect(b.deps.track).toHaveBeenCalledWith("run");
    b.say({ speed: 2, heldForHelp: false, visible: false });
    expect(b.state.textContent).toBe("Your tower will run when you can see it.");
    expect(b.run.hidden).toBe(true);
    expect(b.pause.hidden).toBe(false);
    expect(document.activeElement).toBe(b.pause);
    b.pause.click();
    expect(b.sent[b.sent.length - 1]).toBe("pause");
    b.say();
    expect(document.activeElement).toBe(b.run);
  });

  it("writes the state line only when it changes, so it is read out once", () => {
    const b = bar();
    b.say();
    const set = vi.spyOn(b.state, "textContent", "set");
    b.say();
    expect(set).not.toHaveBeenCalled();
  });

  it("goes back to the game through Back to game", () => {
    const b = bar();
    b.say();
    b.back.click();
    expect(b.deps.backToGame).toHaveBeenCalledTimes(1);
    expect(b.deps.track).toHaveBeenCalledWith("back");
  });
});

/** A stand-in channel. */
function fakeChannel() {
  const channel: BarChannel = { postMessage: vi.fn(), close: vi.fn(), onmessage: null };
  return { channel, hear: (data: unknown) => channel.onmessage?.({ data } as MessageEvent) };
}

/** An iframe the page makes, with a window a test can watch (happy-dom loads
 *  no frame pages). */
function watchedFrame(): { frame: HTMLIFrameElement; win: { postMessage: ReturnType<typeof vi.fn> } } {
  const make = document.createElement.bind(document);
  const frame = make("iframe");
  const win = { postMessage: vi.fn() };
  Object.defineProperty(frame, "contentWindow", { get: () => win });
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => (tag === "iframe" ? frame : make(tag))) as typeof document.createElement);
  return { frame, win };
}

describe("the bar's line to the game", () => {
  it("uses the channel itself when the game shares the page's origin", () => {
    const { channel, hear } = fakeChannel();
    const link = linkToGame(location.origin, window, () => channel)!;
    const heard = vi.fn();
    link.onStatus = heard;
    link.send("run");
    expect(channel.postMessage).toHaveBeenCalledWith({ bar: "run" });
    hear({ junk: true });
    hear(STATUS);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(STATUS);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("frames the game's bridge page on another origin, and hears only that frame", () => {
    const game = "https://verticopolis.com";
    const { frame, win } = watchedFrame();
    const link = linkToGame(game, window, () => {
      throw new Error("no channel on this origin");
    })!;
    expect(document.querySelector("iframe")).toBe(frame);
    expect(frame.getAttribute("src")).toBe(game + BRIDGE_PATH);
    expect(frame.hidden).toBe(true);
    const heard = vi.fn();
    link.onStatus = heard;
    const post = (origin: string, source: unknown, data: unknown) =>
      window.dispatchEvent(new MessageEvent("message", { origin, source: source as Window, data }));
    post("https://evil.example", win, STATUS);
    post(game, window, STATUS);
    post(game, null, STATUS);
    post(game, win, { junk: true });
    expect(heard).not.toHaveBeenCalled();
    post(game, win, STATUS);
    expect(heard).toHaveBeenCalledWith(STATUS);
  });

  it("holds requests until the frame loads, then sends each once", () => {
    const game = "https://verticopolis.com";
    const { frame, win } = watchedFrame();
    const link = linkToGame(game, window)!;
    const post = win.postMessage;
    link.send("hello");
    link.send("hello");
    link.send("run");
    expect(post).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event("load"));
    expect(post.mock.calls).toEqual([
      [{ bar: "hello" }, game],
      [{ bar: "run" }, game],
    ]);
    link.send("pause");
    expect(post).toHaveBeenLastCalledWith({ bar: "pause" }, game);
  });
});

describe("the game's bridge page", () => {
  /** A framed window: its own parent, and the events it hears. */
  function framed() {
    const listeners: Array<(ev: MessageEvent) => void> = [];
    const parent = { postMessage: vi.fn() };
    const win = {
      parent,
      addEventListener: (_: string, fn: (ev: MessageEvent) => void) => listeners.push(fn),
    } as unknown as Window;
    return { win, parent, hear: (ev: Partial<MessageEvent>) => listeners.forEach((fn) => fn(ev as MessageEvent)) };
  }
  const HELP = "https://help.verticopolis.com";

  it("passes the manual's requests to the channel, and only the manual's", () => {
    const { channel } = fakeChannel();
    const f = framed();
    bridgeHelpBar(f.win, HELP, () => channel);
    f.hear({ origin: "https://evil.example", source: f.parent as unknown as Window, data: { bar: "run" } });
    f.hear({ origin: HELP, source: null, data: { bar: "run" } });
    f.hear({ origin: HELP, source: f.parent as unknown as Window, data: { bar: "quit" } });
    expect(channel.postMessage).not.toHaveBeenCalled();
    f.hear({ origin: HELP, source: f.parent as unknown as Window, data: { bar: "run", extra: 1 } });
    expect(channel.postMessage).toHaveBeenCalledWith({ bar: "run" });
  });

  it("passes the game's answers to the manual alone", () => {
    const { channel, hear } = fakeChannel();
    const f = framed();
    bridgeHelpBar(f.win, HELP, () => channel);
    hear({ junk: true });
    expect(f.parent.postMessage).not.toHaveBeenCalled();
    hear(STATUS);
    expect(f.parent.postMessage).toHaveBeenCalledWith(STATUS, HELP);
  });

  it("does nothing when nothing framed it", () => {
    const open = vi.fn();
    const win = { addEventListener: vi.fn() } as unknown as Window & { parent: unknown };
    (win as { parent: unknown }).parent = win;
    bridgeHelpBar(win, HELP, open);
    expect(open).not.toHaveBeenCalled();
  });
});
