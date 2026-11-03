import { describe, expect, it } from "vitest";
import { unreadableSaveNotice } from "./appBoot";

describe("unreadableSaveNotice", () => {
  const flags = { hadReadableSave: false, saveWasNewer: false, unreadableKept: false };

  it("says an older tower loaded when a healthy legacy save was behind the unreadable one", () => {
    expect(unreadableSaveNotice({ ...flags, hadReadableSave: true })).toMatch(/couldn't be read, so an older saved tower was loaded/);
  });

  it("adds the update hint when that unreadable autosave was a newer version's and is kept aside", () => {
    expect(unreadableSaveNotice({ ...flags, hadReadableSave: true, saveWasNewer: true, unreadableKept: true })).toMatch(
      /newer version.*older saved tower was loaded.*Update the game to open the newer one\. It is kept aside/,
    );
  });

  it("does not promise the newer autosave when it could not be kept aside, since the next autosave replaces it", () => {
    const text = unreadableSaveNotice({ ...flags, hadReadableSave: true, saveWasNewer: true });
    expect(text).toMatch(/could not be kept aside, so the next autosave replaces it/);
    expect(text).not.toMatch(/Update the game/);
  });

  it("tells a newer-version save to update the game, and says whether it is kept", () => {
    expect(unreadableSaveNotice({ ...flags, saveWasNewer: true, unreadableKept: true })).toMatch(/Update the game to open it\. It is kept aside/);
    expect(unreadableSaveNotice({ ...flags, saveWasNewer: true })).toMatch(/do not start or load another tower first/);
  });

  it("does not blame a newer version for a save that is only unreadable", () => {
    const text = unreadableSaveNotice(flags);
    expect(text).toMatch(/may be corrupted/);
    expect(text).not.toMatch(/newer/);
  });
});
