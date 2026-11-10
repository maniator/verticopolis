import { describe, expect, it } from "vitest";
import { isBrowserExtensionError } from "./analyticsErrorOrigin";

// The stack from the two "i" events in the Nov 10 analytics report: MetaMask's
// own minified error class, thrown from the script it injects into every page.
const METAMASK_STACK =
  "i: Failed to connect to MetaMask\n" +
  "    at Object.connect (chrome-extension://ejbalbakoplchlghecdalmeeeajnimhm/scripts/inpage.js:7:84292)";

describe("isBrowserExtensionError", () => {
  it("flags a V8 stack whose every frame is an extension script", () => {
    expect(isBrowserExtensionError(METAMASK_STACK)).toBe(true);
  });

  it("flags Gecko and Safari frame formats", () => {
    expect(isBrowserExtensionError("connect@moz-extension://abc/inpage.js:1:2\n@moz-extension://abc/inpage.js:3:4")).toBe(true);
    expect(isBrowserExtensionError("connect@safari-web-extension://abc/inpage.js:1:2")).toBe(true);
    expect(isBrowserExtensionError("    at chrome-extension://abc/content.js:1:2")).toBe(true);
  });

  it("keeps an error with any frame from the game's own code", () => {
    const mixed = `${METAMASK_STACK}\n    at boot (https://verticopolis.app/assets/main-abc.js:1:2)`;
    expect(isBrowserExtensionError(mixed)).toBe(false);
    expect(isBrowserExtensionError("render@https://verticopolis.app/assets/main.js:1:2\nx@chrome-extension://a/b.js:1:1")).toBe(false);
  });

  it("keeps an error with a frame whose location it cannot place", () => {
    for (const frame of [
      "    at run (blob:https://verticopolis.app/0b1c:1:2)",
      "    at <anonymous>",
      "    at Array.forEach (native)",
      "    at async Promise.all (index 0)",
      "    at eval (eval at inject (chrome-extension://abc/inpage.js:1:2), <anonymous>:1:1)",
      "run@blob:https://verticopolis.app/0b1c:1:2",
    ]) {
      expect(isBrowserExtensionError(`${METAMASK_STACK}\n${frame}`), frame).toBe(false);
    }
  });

  it("keeps an error with no frames, since nothing proves its origin", () => {
    expect(isBrowserExtensionError("")).toBe(false);
    expect(isBrowserExtensionError("Error: Script error.")).toBe(false);
  });

  it("does not read a URL in the message line as a frame", () => {
    expect(isBrowserExtensionError("Error: blocked chrome-extension://abc/x.js")).toBe(false);
    expect(isBrowserExtensionError("Error: failed at chrome-extension://abc/x.js")).toBe(false);
    expect(isBrowserExtensionError("Error: bad (chrome-extension://abc/x.js)")).toBe(false);
  });

  it("flags an error event whose source is an extension script, whatever the stack says", () => {
    expect(isBrowserExtensionError("", "chrome-extension://abc/inpage.js")).toBe(true);
    expect(isBrowserExtensionError("", "https://verticopolis.app/assets/main.js")).toBe(false);
  });

  it("matches the scheme without regard to case", () => {
    expect(isBrowserExtensionError("    at x (Chrome-Extension://abc/a.js:1:1)")).toBe(true);
  });
});
