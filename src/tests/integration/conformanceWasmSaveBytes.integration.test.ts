/**
 * The autosave's bytes (`Engine.saveBytes`) through the real engine binding:
 * for every `.vctower` fixture, played on for a game day so the crowd and the
 * cars' timers fill, the stamped bytes are byte for byte the UTF-8 of what
 * `stampText(serialize())` made before the autosave took bytes. So the stored
 * autosave inflates to the very save the game stored before, and a load of it
 * is the same game.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Engine } from "../../engineBinding/engine";
import { stampText } from "../../storage/saveStamp";
import { inflateCapped } from "../../storage/saveCompression";
import { packHere } from "../../storage/savePacker";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

const FIXTURES = resolve(__dirname, "../../../conformance/fixtures");
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".vctower"))
  .sort();

const engines = (): typeof Engine => (wasm() as unknown as { Engine: typeof Engine }).Engine;

describe.runIf(hasWasmPackage())("the autosave's stamped bytes through the engine binding", () => {
  it.each(fixtures)("%s: saveBytes is the stamped save text's UTF-8, and packs back to it", async (name) => {
    const engine = engines().fromVctower(readFileSync(resolve(FIXTURES, name), "utf8"));
    try {
      for (let minute = 0; minute < 1440; minute++) engine.tick(1);
      const { json, stamp } = stampText(engine.serialize());
      const bytes = engine.saveBytes(stamp.appVersion, stamp.savedAt);
      const expected = new TextEncoder().encode(json);
      expect(bytes.length).toBe(expected.length);
      expect(Buffer.from(bytes).equals(Buffer.from(expected))).toBe(true);
      // What the store keeps inflates to the same bytes.
      const { packed } = await packHere(bytes.slice());
      expect(Buffer.from(inflateCapped(packed)).equals(Buffer.from(expected))).toBe(true);
      // And the stamped save loads as the game the unstamped one does.
      const back = engines().fromSave(new TextDecoder().decode(bytes));
      const plain = engines().fromSave(engine.serialize());
      try {
        expect(back.stateDigest()).toBe(plain.stateDigest());
        expect(back.crowdDigest()).toBe(plain.crowdDigest());
      } finally {
        back.free();
        plain.free();
      }
    } finally {
      engine.free();
    }
  });
});
