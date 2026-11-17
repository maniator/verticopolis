import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_REMEMBERED,
  PLAYER_TEXT_PLACEHOLDER as P,
  addPlayerTextSource,
  knownPlayerText,
  mentionsJson,
  nameAndStem,
  rememberFileName,
  rememberPlayerText,
  resetPlayerTextForTest,
  scrubJsonEcho,
  scrubPlayerText,
} from "./analyticsPlayerText";

beforeEach(() => resetPlayerTextForTest());

describe("scrubPlayerText", () => {
  it("replaces every whole-word occurrence, in any case", () => {
    expect(scrubPlayerText('Couldn\'t save "Harmony Tower": harmony tower is busy', ["Harmony Tower"])).toBe(
      `Couldn't save "${P}": ${P} is busy`,
    );
  });

  it("leaves a name that sits inside a longer word alone", () => {
    expect(scrubPlayerText("TowerTooLargeError: Tower is full", ["Tower"])).toBe(`TowerTooLargeError: ${P} is full`);
    expect(scrubPlayerText("Ångström2 Ångström", ["Ångström"])).toBe(`Ångström2 ${P}`);
  });

  it("treats a name's regex characters as plain text", () => {
    expect(scrubPlayerText("open C++ (Tower) failed; open CCC Tower ok", ["C++ (Tower)"])).toBe(
      `open ${P} failed; open CCC Tower ok`,
    );
  });

  it("matches a name next to punctuation and file extensions", () => {
    expect(scrubPlayerText("at blob:Spire.vctower:1:2", ["Spire"])).toBe(`at blob:${P}.vctower:1:2`);
  });

  it("replaces back-to-back occurrences that share one separator", () => {
    expect(scrubPlayerText("Spire Spire,spire", ["Spire"])).toBe(`${P} ${P},${P}`);
  });

  it("finds a second name after the first one changed the text", () => {
    expect(scrubPlayerText("Old Mill then Harbor", ["Old Mill", "Harbor"])).toBe(`${P} then ${P}`);
  });

  it("returns the text unchanged when no name is in it", () => {
    expect(scrubPlayerText("Cannot read properties of undefined (reading 'x')", ["Spire"])).toBe(
      "Cannot read properties of undefined (reading 'x')",
    );
    expect(scrubPlayerText("", ["Spire"])).toBe("");
  });
});

describe("scrubJsonEcho", () => {
  it("blanks everything a Chrome JSON error quotes, inner quotes included", () => {
    expect(scrubJsonEcho(`Unexpected token 'S', "{"a": Secret Spire}" is not valid JSON`)).toBe(`Unexpected token "${P}" is not valid JSON`);
    expect(scrubJsonEcho(`Unexpected token 'S', ..."a": Secret "... is not valid JSON`)).toBe(`Unexpected token "${P}"... is not valid JSON`);
  });

  it("blanks across a line break in the echoed text", () => {
    expect(scrubJsonEcho(`Unexpected token 'x', "{\n Secret}" is not valid JSON`)).toBe(`Unexpected token "${P}" is not valid JSON`);
  });

  it("blanks the input a Safari JSON error quotes", () => {
    expect(scrubJsonEcho(`JSON Parse error: Unexpected identifier "Spire"`)).toBe(`JSON Parse error: Unexpected identifier "${P}"`);
  });

  it("blanks to the end when a quote has no partner", () => {
    expect(scrubJsonEcho(`Unexpected token in JSON: "Secret Spi`)).toBe(`Unexpected token in JSON: "${P}"`);
  });

  it("returns a message with no quote as it is", () => {
    const msg = "JSON.parse: unexpected character at line 1 column 1 of the JSON data";
    expect(scrubJsonEcho(msg)).toBe(msg);
  });

  it("says which messages are JSON errors", () => {
    expect(mentionsJson(`"x" is not valid JSON`)).toBe(true);
    expect(mentionsJson("Cannot read properties of undefined (reading 'json')")).toBe(false);
  });
});

describe("the known player text", () => {
  it("reads every source at call time, longest first, without duplicates in any case", () => {
    let name = "Spire";
    addPlayerTextSource(() => [name, "Harbor One Annex"]);
    addPlayerTextSource(() => ["spire", "Harbor One", null, undefined]);
    expect(knownPlayerText()).toEqual(["Harbor One Annex", "Harbor One", "Spire"]);
    name = "Lighthouse";
    expect(knownPlayerText()).toContain("Lighthouse");
  });

  it("skips text shorter than two characters, blank text and a source that throws", () => {
    addPlayerTextSource(() => ["A", "  ", "Ok"]);
    addPlayerTextSource(() => {
      throw new Error("engine gone");
    });
    rememberPlayerText("B");
    expect(knownPlayerText()).toEqual(["Ok"]);
  });

  it("keeps the names the game gives an unnamed tower or file", () => {
    addPlayerTextSource(() => ["Tower", "tower one", "Tower Two"]);
    expect(knownPlayerText()).toEqual(["Tower Two"]);
  });

  it("stops reading a source once it is removed", () => {
    const source = vi.fn(() => ["Spire"]);
    const remove = addPlayerTextSource(source);
    remove();
    remove(); // a second removal is harmless
    expect(knownPlayerText()).toEqual([]);
    expect(source).not.toHaveBeenCalled();
  });

  it("keeps the newest remembered text, trimmed, up to the limit", () => {
    for (let i = 0; i < MAX_REMEMBERED + 5; i++) rememberPlayerText(` Tower ${i} `);
    const known = knownPlayerText();
    expect(known).toHaveLength(MAX_REMEMBERED);
    expect(known).toContain(`Tower ${MAX_REMEMBERED + 4}`);
    expect(known).not.toContain("Tower 0");
    rememberPlayerText("Tower 5"); // the oldest kept, noted again, is kept as newest
    rememberPlayerText("Tower 99");
    expect(knownPlayerText()).toContain("Tower 5");
  });

  it("remembers a file name with and without its extension", () => {
    expect(nameAndStem("Spire.vctower")).toEqual(["Spire.vctower", "Spire"]);
    expect(nameAndStem(".hidden")).toEqual([".hidden"]);
    rememberFileName("My Tower.TDT");
    rememberFileName(null);
    expect(knownPlayerText()).toEqual(["My Tower.TDT", "My Tower"]);
  });
});
