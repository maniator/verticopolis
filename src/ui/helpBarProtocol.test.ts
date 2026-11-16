import { describe, expect, it } from "vitest";
import { isBarMessage, isGameStatus } from "./helpBarProtocol";

const STATUS = {
  game: "status",
  speed: 2,
  heldForHelp: false,
  visible: true,
  hud: { date: "Wed", time: "9:00 AM", money: "$1", population: "1", stars: "★" },
};

describe("the Help bar's messages", () => {
  it("knows a bar's three requests and nothing else", () => {
    for (const bar of ["hello", "run", "pause"]) expect(isBarMessage({ bar })).toBe(true);
    for (const data of [null, undefined, "hello", {}, { bar: "close" }, { bar: 1 }]) expect(isBarMessage(data)).toBe(false);
  });

  it("takes a well-formed status", () => {
    expect(isGameStatus(STATUS)).toBe(true);
  });

  it("drops a status with a bad speed, flag or HUD field", () => {
    const bad = [
      { ...STATUS, game: "other" },
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
