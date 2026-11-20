import { beforeEach, describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import {
  FIRST_PICKED_LOOK,
  pickedSkyBridgeLook,
  pickSkyBridgeLook,
  syncSkyBridgeLookStrip,
} from "./skyBridgeLookStrip";

/** The Sky Bridge tool's look strip: one button per catalog look, shown only
 *  while the tool is armed, the picked look pressed. */
describe("the bridge look strip", () => {
  const rule = catalogFor("modern").rules.skyBridge;
  let strip: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    strip = document.createElement("div");
    strip.id = "sky-bridge-look-strip";
    document.body.append(strip);
    pickSkyBridgeLook(FIRST_PICKED_LOOK, null);
  });

  it("lists every look the catalog publishes while the tool is armed, the glass skywalk first picked", () => {
    syncSkyBridgeLookStrip({ type: "skyBridge" }, rule);
    expect(strip.hidden).toBe(false);
    const buttons = [...strip.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(rule!.looks);
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent)).toEqual([
      "Glass Skywalk",
    ]);
  });

  it("picks a look on a click and presses it", () => {
    syncSkyBridgeLookStrip({ type: "skyBridge" }, rule);
    strip.querySelector<HTMLButtonElement>('button[data-look="3"]')!.click();
    expect(pickedSkyBridgeLook()).toBe(3);
    expect(strip.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Deco Arcade");
  });

  it("hides for any other tool and in a mode with no bridges", () => {
    syncSkyBridgeLookStrip({ type: "build" }, rule);
    expect(strip.hidden).toBe(true);
    syncSkyBridgeLookStrip({ type: "skyBridge" }, null);
    expect(strip.hidden).toBe(true);
    expect(strip.childElementCount).toBe(0);
  });
});
