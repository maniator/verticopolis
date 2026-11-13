import { describe, expect, it, vi } from "vitest";
import { heldLobbyHeight, LobbyHeightChoice, trackLobbyHeightKeys } from "./lobbyHeight";

const mods = (ctrlKey: boolean, shiftKey: boolean, metaKey = false) => ({ ctrlKey, shiftKey, metaKey });

describe("the lobby tool's height (#308)", () => {
  it("reads the original's modifiers: Ctrl for two stories, Ctrl+Shift for three, Cmd as Ctrl", () => {
    expect(heldLobbyHeight(mods(false, false))).toBe(1);
    expect(heldLobbyHeight(mods(false, true))).toBe(1); // Shift alone still pans
    expect(heldLobbyHeight(mods(true, false))).toBe(2);
    expect(heldLobbyHeight(mods(true, true))).toBe(3);
    expect(heldLobbyHeight(mods(false, true, true))).toBe(3);
  });

  it("asks for the held height while held, else the pick, clamped to 1 through 3", () => {
    const choice = new LobbyHeightChoice();
    expect(choice.height).toBe(1);
    choice.pick(2);
    expect([choice.height, choice.picked]).toEqual([2, 2]);
    choice.hold(mods(true, true));
    expect([choice.height, choice.picked]).toEqual([3, 2]);
    choice.release();
    expect(choice.height).toBe(2);
    choice.pick(9);
    expect(choice.height).toBe(3);
    choice.pick(Number.NaN);
    expect(choice.height).toBe(1);
  });

  it("tells its listeners only when the height or the pick changes", () => {
    const choice = new LobbyHeightChoice();
    const heard = vi.fn();
    const stop = choice.onChange(heard);
    choice.hold(mods(false, false));
    choice.pick(1);
    expect(heard).not.toHaveBeenCalled();
    choice.hold(mods(true, false));
    choice.pick(3);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    choice.release();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("follows key, pointer and focus events on the window, and lets go of them", () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const target = {
      addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => void handlers.set(type, fn)),
      removeEventListener: vi.fn((type: string) => void handlers.delete(type)),
    } as unknown as Window;
    const choice = new LobbyHeightChoice();
    const stop = trackLobbyHeightKeys(choice, target);
    expect([...handlers.keys()].sort()).toEqual(["blur", "keydown", "keyup", "pointerdown", "pointermove"]);
    handlers.get("keydown")?.(mods(true, false));
    expect(choice.height).toBe(2);
    handlers.get("pointermove")?.(mods(true, true));
    expect(choice.height).toBe(3);
    handlers.get("blur")?.({});
    expect(choice.height).toBe(1);
    stop();
    expect(handlers.size).toBe(0);
  });
});
