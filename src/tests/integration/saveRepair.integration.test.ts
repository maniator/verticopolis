import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import { newViewReader } from "../../game/portAccess";
import { SaveGame } from "../../storage/SaveGame";
import { MAX_SAVE_INFLATED_BYTES, STORE_MAGIC, toBase64 } from "../../storage/saveCompression";
import { engineSaveText } from "../../storage/saveTextRead";
import { fromTowerFile, toTowerFile } from "../../storage/towerFileCodec";
import { engineFromSave, newEngine, noEngine } from "../portKit/rustEngine";

/**
 * The storage code's saves on the Rust engine: what the engine makes of the
 * text the codecs and the repair hand it. The storage unit tests
 * (`src/storage/`) check the text itself, without an engine.
 */

const FIXTURE = resolve(__dirname, "../../../conformance/fixtures/split-tower.vctower");

/** A save packed as `SaveGame.saveTo` stores it. */
const storeValue = (text: string): string => STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(text), { level: 1 }));

/** A stored save carried to a `.vctower` file, then read by the import. */
async function throughTheCodec(text: string): Promise<string> {
  const file = toTowerFile(storeValue(text));
  if (!file.ok) throw new Error("the codec refused the save");
  return SaveGame.importText(file.text);
}

/** A freshly founded tower's save, as the engine writes it (no appVersion). */
const founded = (): Record<string, unknown> => JSON.parse(newEngine(1).serialize()) as Record<string, unknown>;

const excavatedOf = (text: string): string[] => (JSON.parse(text) as { excavated: string[] }).excavated;

describe.skipIf(noEngine)("the storage code's saves on the engine", () => {
  it("keeps one excavated entry where two halves of a pair repair to the same text", () => {
    const save = JSON.stringify({ ...founded(), excavated: ["\ud800", "\udc00"] });
    // The engine repairs the text it is handed, and so does the read the app
    // hands it: either way the two halves are one entry.
    expect(excavatedOf(engineFromSave(save).serialize())).toEqual(["\uFFFD"]);
    expect(excavatedOf(engineFromSave(engineSaveText(save)).serialize())).toEqual(["\uFFFD"]);
  });

  it("marks a tower with no appVersion as a founder's, after the codec carried it", async () => {
    const unstamped = await throughTheCodec(JSON.stringify(founded()));
    const stamped = await throughTheCodec(JSON.stringify({ ...founded(), appVersion: "2.4.0" }));
    // The founder rule runs on a load the app makes (`loadSave`), as a stored
    // or imported tower opens.
    const founderAfterLoad = (text: string) => {
      const engine = newEngine(1);
      expect(engine.loadSave(text)[0]).toBe(1);
      return engine.founder();
    };
    expect([founderAfterLoad(unstamped), founderAfterLoad(stamped)]).toEqual([true, false]);
  });

  it("loads a tower exported, carried back and imported, with its name, clock and population", async () => {
    const source = engineFromSave(await SaveGame.importText(readFileSync(FIXTURE, "utf8")));
    const back = fromTowerFile(await SaveGame.export(source.serialize()));
    if (!back.ok) throw new Error("the exported file did not read back");
    const forward = toTowerFile(back.value);
    if (!forward.ok) throw new Error("the stored value did not carry forward");
    const loaded = engineFromSave(await SaveGame.importText(forward.text));
    const read = (e: typeof source) => {
      const { towerName, minutes } = JSON.parse(e.serialize()) as { towerName: string; minutes: number };
      return { towerName, minutes, population: newViewReader(e).header.population };
    };
    const want = read(source);
    expect(want.population).toBeGreaterThan(0);
    expect(read(loaded)).toEqual(want);
  });

  it("opens a save of exactly the cap that the storage writers pass, as saveCap.test.ts builds it", () => {
    const save = founded() as { towerName: string };
    const base = new TextEncoder().encode(JSON.stringify(save)).length;
    const towerName = save.towerName + "x".repeat(MAX_SAVE_INFLATED_BYTES - base);
    const text = JSON.stringify({ ...save, towerName });
    expect(new TextEncoder().encode(text).length).toBe(MAX_SAVE_INFLATED_BYTES);
    const engine = newEngine(1);
    expect(engine.loadSave(text)[0]).toBe(1);
    expect((JSON.parse(engine.serialize()) as { towerName: string }).towerName).toBe(towerName);
  }, 60_000);
});
