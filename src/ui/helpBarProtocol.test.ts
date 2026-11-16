import { describe, expect, it } from "vitest";
import { GONE_AFTER_MS, HELLO_EVERY_MS, STATUS_EVERY_MS, barMessage, isBarMessage, isGameStatus, isTabId, newTabId } from "./helpBarProtocol";

const STATUS = {
  game: "status",
  tab: "0123456789abcdef",
  speed: 2,
  heldForHelp: false,
  visible: true,
  hud: {
    date: "Wed",
    time: "9:00 AM",
    money: "$1",
    population: "1",
    stars: "★",
  },
};

describe("the Help bar's messages", () => {
  it("knows a bar's three requests and nothing else", () => {
    for (const bar of ["hello", "run", "pause"]) expect(isBarMessage({ bar })).toBe(true);
    for (const data of [null, undefined, "hello", {}, { bar: "close" }, { bar: 1 }]) expect(isBarMessage(data)).toBe(false);
  });

  it("takes a request naming a well-formed tab, and drops a bad tab", () => {
    expect(isBarMessage({ bar: "run", tab: STATUS.tab })).toBe(true);
    for (const tab of ["", "xyz", "0123456789ABCDEF", "0123456789abcdef0", 7, null]) expect(isBarMessage({ bar: "run", tab }), String(tab)).toBe(false);
  });

  it("names the tab on the wire only when there is one", () => {
    expect(barMessage("hello")).toEqual({ bar: "hello" });
    expect(Object.keys(barMessage("hello"))).toEqual(["bar"]);
    expect(barMessage("pause", STATUS.tab)).toEqual({
      bar: "pause",
      tab: STATUS.tab,
    });
  });

  it("makes a tab id of sixteen hex digits from eight random bytes", () => {
    const id = newTabId((b) => b.fill(0xa5));
    expect(id).toBe("a5".repeat(8));
    expect(isTabId(id)).toBe(true);
    expect(isTabId(newTabId())).toBe(true);
    expect(newTabId()).not.toBe(newTabId());
  });

  it("waits out a lost hello and a late tick before calling the game gone", () => {
    // The game answers each hello at once; a hidden game tab's own ticks may
    // not come at all, so the bar must outlast two hello gaps.
    expect(GONE_AFTER_MS).toBeGreaterThan(HELLO_EVERY_MS * 2);
    expect(GONE_AFTER_MS).toBeGreaterThan(STATUS_EVERY_MS);
  });

  it("takes a well-formed status", () => {
    expect(isGameStatus(STATUS)).toBe(true);
  });

  it("drops a status with a bad speed, flag or HUD field", () => {
    const bad = [
      { ...STATUS, game: "other" },
      { ...STATUS, tab: undefined },
      { ...STATUS, tab: "nope" },
      { ...STATUS, speed: 4 },
      { ...STATUS, speed: 1.5 },
      { ...STATUS, speed: "2" },
      { ...STATUS, visible: "yes" },
      { ...STATUS, heldForHelp: 1 },
      { ...STATUS, hud: null },
      { ...STATUS, hud: { ...STATUS.hud, money: 5 } },
      { ...STATUS, hud: { ...STATUS.hud, stars: undefined } },
      { ...STATUS, hud: { ...STATUS.hud, date: "x".repeat(65) } },
      null,
    ];
    for (const data of bad) expect(isGameStatus(data), JSON.stringify(data)).toBe(false);
  });
});
