// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import { HELP_BAR_CHANNEL, isGameStatus, type BarRequest, type GameStatus } from "../../ui/helpBarProtocol";

/**
 * The game's side of the Help bar (#2035) on the real UI, over a real
 * BroadcastChannel: it answers a bar with the status bar's own words, keeps
 * the tower running through the Help pause, and pauses it again until the
 * player is back.
 */

/** A speed the controller reads back after it sets it, as the game's does. */
function speedAt(start: number) {
  let speed = start;
  return { onSpeed: vi.fn((s: number) => (speed = s)), getSpeed: () => speed, now: () => speed };
}

function leaveAndReturn(): void {
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  focus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  focus.mockRestore();
}

let bar: BroadcastChannel;

/** Send `request` as a Help bar and wait for the game's answer. */
function ask(request: BarRequest): Promise<GameStatus> {
  return new Promise((resolve) => {
    bar.onmessage = (ev: MessageEvent) => {
      if (isGameStatus(ev.data)) resolve(ev.data);
    };
    bar.postMessage({ bar: request });
  });
}

describe("the game's side of the Help bar", () => {
  beforeEach(() => {
    mountAppDom();
    bar = new BroadcastChannel(HELP_BAR_CHANNEL);
  });
  afterEach(() => {
    bar.close();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("answers a bar with the status bar's own words", async () => {
    makeUI();
    document.getElementById("stat-money")!.textContent = "$1,234";
    document.getElementById("stat-pop")!.textContent = "567";
    const status = await ask("hello");
    expect(status.hud.money).toBe("$1,234");
    expect(status.hud.population).toBe("567");
  });

  it("keeps the tower running at its old speed, and pauses it again until the player is back", async () => {
    const speed = speedAt(3);
    const { ui } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    ui.showHelp("game_menu");
    expect(speed.now()).toBe(0);
    expect(await ask("hello")).toMatchObject({ speed: 0, heldForHelp: true });

    expect(await ask("run")).toMatchObject({ speed: 3, heldForHelp: false });
    // The player coming back changes nothing now: Help let go.
    leaveAndReturn();
    expect(speed.now()).toBe(3);

    expect(await ask("pause")).toMatchObject({ speed: 0, heldForHelp: true });
    leaveAndReturn();
    expect(speed.now()).toBe(3);
  });

  it("starts a tower the player had paused at slow speed", async () => {
    const speed = speedAt(0);
    makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    expect(await ask("run")).toMatchObject({ speed: 1 });
  });
});
