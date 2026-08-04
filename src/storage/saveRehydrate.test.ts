import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { markFounderFromLoadedFile } from "../engine/sim/founderStatus";
import { SaveGame } from "./SaveGame";
import { fromBase64, inflateCapped, STORE_MAGIC, TOWER_FILE_MAGIC } from "./saveCompression";
import { fromTowerFile, toTowerFile } from "./saveMigration";
import { PRE_2_0_SAVE, storeValue } from "./saveMigration.fixture";

/**
 * The reverse converter, which is the byte-fidelity core of the read path.
 *
 * Written and tested BEFORE any call site is rewired, deliberately: if a
 * `.vctower` written by `CompressionStream` cannot be read back by fflate, the
 * whole hydration design changes shape, and that is worth knowing while it
 * costs nothing.
 */

/** Decode a `VCZ1:` value the way `readSlot` does: fflate, no stream API. */
function decodeStoreValue(value: string): Record<string, unknown> {
  expect(value.startsWith(STORE_MAGIC)).toBe(true);
  const bytes = inflateCapped(fromBase64(value.slice(STORE_MAGIC.length)));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<string, unknown>;
}

describe("fromTowerFile is a three-way answer", () => {
  it("round-trips a re-headered value back to exactly what it started as", () => {
    const original = storeValue(PRE_2_0_SAVE);
    const forward = toTowerFile(original);
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;

    const back = fromTowerFile(forward.text);
    expect(back).toEqual({ ok: true, value: original });
  });

  it("reports a NEWER container as too-new, never as unreadable or absent", () => {
    // The distinction the shim design could not preserve. As `unreadable` the
    // record gets stashed and then overwritten by the 30s autosave; as absent
    // the splash offers New Tower and the first save commits over it. Either
    // way a recoverable tower becomes an unrecoverable one.
    const newer = "VCTOWER2\n" + storeValue(PRE_2_0_SAVE).slice(STORE_MAGIC.length) + "\n";
    expect(fromTowerFile(newer)).toEqual({ ok: false, reason: "too-new" });
    expect(fromTowerFile("VCTOWER17\nAAAA\n")).toEqual({ ok: false, reason: "too-new" });
  });

  it("reports anything that is not a tower container as unreadable", () => {
    for (const junk of ["", "   ", "{}", "VCZ1:AAAA", "NOTATOWER\nAAAA\n", "VCTOWER\nAAAA\n"]) {
      expect(fromTowerFile(junk), JSON.stringify(junk)).toEqual({ ok: false, reason: "unreadable" });
    }
  });

  it("refuses a header with no payload rather than producing a bare VCZ1: prefix", () => {
    // `readSlot` would hand "" to `fromBase64` and report the slot corrupt,
    // which is a worse answer than saying so here.
    expect(fromTowerFile("VCTOWER1\n")).toEqual({ ok: false, reason: "unreadable" });
    expect(fromTowerFile("VCTOWER1\n   \n")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("tolerates the whitespace a store is entitled to introduce", () => {
    // `readSlot` does NOT strip whitespace; it passes the payload straight to
    // `fromBase64`. So the tolerance has to live here rather than downstream.
    const original = storeValue(PRE_2_0_SAVE);
    const payload = original.slice(STORE_MAGIC.length);
    for (const [name, text] of [
      ["CRLF", "VCTOWER1\r\n" + payload + "\r\n"],
      ["wrapped", "VCTOWER1\n" + payload.slice(0, 20) + "\n" + payload.slice(20) + "\n"],
      ["trailing spaces", "VCTOWER1\n" + payload + "   "],
    ] as const) {
      const back = fromTowerFile(text);
      expect(back.ok, name).toBe(true);
      if (back.ok) expect(back.value, name).toBe(original);
    }
  });
});

describe("Founder survives the reverse trip", () => {
  it("keeps appVersion absent, so the badge is still earned on the read path", () => {
    const back = fromTowerFile((toTowerFile(storeValue(PRE_2_0_SAVE)) as { text: string }).text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    const decoded = decodeStoreValue(back.value);
    expect(decoded.appVersion).toBeUndefined();
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, decoded);
    expect(sim.founder).toBe(true);
  });

  it("NEGATIVE CONTROL: a stamped tower still does not earn it", () => {
    const stamped = { ...PRE_2_0_SAVE, appVersion: "2.9.0" };
    const back = fromTowerFile((toTowerFile(storeValue(stamped)) as { text: string }).text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, decodeStoreValue(back.value));
    expect(sim.founder).toBe(false);
  });
});

/**
 * The cross-codec direction nothing has ever exercised.
 *
 * The migration proved fflate's `deflateSync` output decodes through
 * `DecompressionStream`. Hydration needs the OTHER direction: a desktop
 * autosave is written by `SaveGame.export`, which packs with
 * `CompressionStream`, and hydration then hands that payload to `readSlot`,
 * which unpacks with fflate's `inflateCapped`. Both are raw deflate, so it
 * should hold, and it is the path every desktop-written tower takes home.
 */
describe("a CompressionStream-written tower reads back through fflate", () => {
  it("survives export, reverse conversion, and an fflate decode", async () => {
    const sim = Simulation.newGame(9182);
    const exported = await SaveGame.export(sim);
    expect(exported.startsWith(TOWER_FILE_MAGIC + "\n")).toBe(true);

    const back = fromTowerFile(exported);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // The fflate side, which is what `readSlot` actually calls.
    const decoded = decodeStoreValue(back.value);
    expect(decoded.minutes).toBe(sim.serialize().minutes);
    expect(decoded.towerName).toBe(sim.tower.towerName);
  });

  it("and the tower still loads through the real reader", async () => {
    // End to end on the codec: export with the stream API, convert back, then
    // load through `SaveGame.import`, which is the production reader.
    const sim = Simulation.newGame(4242);
    const exported = await SaveGame.export(sim);
    const back = fromTowerFile(exported);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // Re-header forward again and hand it to import, closing the loop.
    const forward = toTowerFile(back.value);
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    const loaded = await SaveGame.import(forward.text);
    expect(loaded.population).toBe(sim.population);
    expect(loaded.tower.towerName).toBe(sim.tower.towerName);
  });
});
