import { afterEach, describe, expect, it, vi } from "vitest";
import { keyId, MapKeyKeeper } from "./overviewMapKeys";

let keeper: MapKeyKeeper | null = null;
afterEach(() => {
  keeper?.dispose();
  keeper = null;
  document.body.innerHTML = "";
});

/** A window root with a focusable child, the page outside it, and the game's
 *  window listeners. */
function setup() {
  document.body.innerHTML = '<div id="root"><canvas id="map" tabindex="0"></canvas></div><button id="out"></button>';
  const root = document.getElementById("root")!;
  const map = document.getElementById("map")!;
  const out = document.getElementById("out")!;
  keeper = new MapKeyKeeper(root);
  const k = keeper;
  // The map's own keydown: keep everything (the window keeps the game keys).
  root.addEventListener("keydown", (e) => k.keep(e));
  const down = vi.fn();
  const up = vi.fn();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  const done = () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
  };
  return { map, out, down, up, done };
}

const key = (type: string, code: string, k: string, repeat = false) => new KeyboardEvent(type, { code, key: k, repeat, bubbles: true, cancelable: true });

describe("keeping the map's keys from the game (CAP-5)", () => {
  it("names a key by its code, so a modifier changing the name still matches", () => {
    expect(keyId({ code: "KeyA", key: "A" })).toBe("KeyA");
    expect(keyId({ code: "", key: "Enter" })).toBe("Enter");
  });

  it("keeps a kept key's keyup even when Shift changed its name, and lets other keyups through", () => {
    const t = setup();
    t.map.dispatchEvent(key("keydown", "KeyA", "a"));
    t.map.dispatchEvent(key("keyup", "KeyA", "A"));
    t.map.dispatchEvent(key("keyup", "Space", " "));
    t.done();
    expect(t.down).not.toHaveBeenCalled();
    expect(t.up).toHaveBeenCalledTimes(1);
  });

  it("keeps a held key's repeats once focus has left the window, then lets a fresh press through", () => {
    const t = setup();
    t.map.dispatchEvent(key("keydown", "Escape", "Escape"));
    const repeat = key("keydown", "Escape", "Escape", true);
    t.out.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    t.out.dispatchEvent(key("keyup", "Escape", "Escape"));
    t.out.dispatchEvent(key("keydown", "Escape", "Escape"));
    t.out.dispatchEvent(key("keyup", "Escape", "Escape"));
    t.done();
    expect(t.down).toHaveBeenCalledTimes(1);
    expect(t.up).toHaveBeenCalledTimes(1);
  });

  it("leaves the release of a key held before focus arrived to the game", () => {
    const t = setup();
    t.map.dispatchEvent(key("keydown", "ArrowUp", "ArrowUp", true));
    t.map.dispatchEvent(key("keyup", "ArrowUp", "ArrowUp"));
    t.done();
    expect(t.up).toHaveBeenCalledTimes(1);
  });

  it("forgets every kept key when cleared (the page lost focus)", () => {
    const t = setup();
    t.map.dispatchEvent(key("keydown", "KeyX", "x"));
    keeper!.clear();
    t.out.dispatchEvent(key("keyup", "KeyX", "x"));
    t.done();
    expect(t.up).toHaveBeenCalledTimes(1);
  });
});
