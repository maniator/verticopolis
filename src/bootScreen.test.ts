import { describe, it, expect } from "vitest";
import { resolveBootScreen } from "./bootScreen";

/**
 * The pure boot-screen decision, extracted from the GameApp constructor (which
 * needs a canvas + WebGL) so the rule is covered without a browser. The rule: the
 * title screen loads on every boot, except an app-initiated resume reload (a
 * post-"Update now" reload OR a WebGL context-loss recovery reload) with a
 * readable save to resume into. See src/bootScreen.ts.
 */
describe("resolveBootScreen: which first screen a boot presents", () => {
  const S = (o: Partial<Parameters<typeof resolveBootScreen>[0]>) =>
    resolveBootScreen({ hadReadableSave: false, justUpdated: false, justRecovered: false, ...o });

  it("resumes only when a readable save is paired with an app-initiated resume reload", () => {
    // A readable save + a resume reload (update or recovery) drops straight in.
    expect(S({ hadReadableSave: true, justUpdated: true })).toBe("resume"); // post-update reload
    expect(S({ hadReadableSave: true, justRecovered: true })).toBe("resume"); // GPU-crash recovery reload
    expect(S({ hadReadableSave: true, justUpdated: true, justRecovered: true })).toBe("resume");
  });

  it("shows the splash for an ordinary boot with a save (cold reopen / manual reload)", () => {
    expect(S({ hadReadableSave: true })).toBe("splash");
  });

  it("shows the splash when a resume reload landed on a corrupt/absent save", () => {
    // Nothing readable to resume into, so the resume flags don't skip the splash.
    expect(S({ hadReadableSave: false, justUpdated: true })).toBe("splash");
    expect(S({ hadReadableSave: false, justRecovered: true })).toBe("splash");
  });

  it("shows the splash on a first run (no save, no resume)", () => {
    expect(S({})).toBe("splash");
  });
});
