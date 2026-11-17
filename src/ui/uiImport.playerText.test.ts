import { beforeEach, describe, expect, it, vi } from "vitest";
import { knownPlayerText, resetPlayerTextForTest } from "../analyticsPlayerText";
import type { UI } from "./UI";
import { readPickedFile } from "./uiImport";

describe("readPickedFile and the error scrubber (#607)", () => {
  beforeEach(() => resetPlayerTextForTest());

  it("remembers the picked file's name, with and without its extension, before reading it", () => {
    const ui = { cb: { onImport: vi.fn(), onImportLegacy: vi.fn() }, sayVisibly: vi.fn() } as unknown as UI;
    readPickedFile(ui, new File(["{}"], "Harbor Point.vctower"));
    expect(knownPlayerText()).toEqual(["Harbor Point.vctower", "Harbor Point"]);
  });
});
