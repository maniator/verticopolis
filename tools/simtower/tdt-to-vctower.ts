// .TDT -> vctower importer test, and empty-tower export/real-save diff.
//
//   npx tsx tools/simtower/tdt-to-vctower.ts <file.TDT> [...]
// For each .TDT: runs the engine's own parseTDT (tdt -> our SerializedGame) and
// prints a summary + the import report's fidelity warnings. Also writes a
// .vctower next to each input so it can be loaded in our game.
//
// With --diff-empty: also builds an EMPTY-tower .TDT with our exporter and
// byte-diffs it against the first input (a real empty SimTower save), to find
// what our exporter emits differently.
//
// Imports the engine directly (run via tsx, which strips the TypeScript
// in-process), so it exercises the exact parseTDT/buildTDT the app ships.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { deflateSync } from "fflate";
import { parseTDT } from "../../src/storage/tdtImport";
import { buildTDT } from "../../src/storage/tdtExport";
import { SAVE_VERSION } from "../../src/engine/saveMigration";
import type { SerializedGame } from "../../src/engine/types";

function toVctower(save: unknown) {
  const json = new TextEncoder().encode(JSON.stringify(save));
  const b64 = Buffer.from(deflateSync(json, { level: 1 })).toString("base64");
  return "VCTOWER1\n" + b64;
}

function main() {
  const args = process.argv.slice(2);
  const diffEmpty = args.includes("--diff-empty");
  const inputs = args.filter((a) => !a.startsWith("--"));
  if (!inputs.length) {
    console.error("usage: npx tsx tools/simtower/tdt-to-vctower.ts <file.TDT> [--diff-empty]");
    process.exit(2);
  }

  for (const input of inputs) {
    // Read inside the try too: an ENOENT / unreadable file on one path should
    // report that file and continue, not abort the whole batch.
    try {
      const bytes = new Uint8Array(readFileSync(input));
      console.log(`\n== ${basename(input)} (${bytes.length} bytes) ==`);
      const { save, report } = parseTDT(bytes.buffer as ArrayBuffer, basename(input));
      const rooms = (save.units || []).filter((u) => u.kind !== "floor" && u.kind !== "lobby");
      const byKind: Record<string, number> = {};
      for (const u of rooms) byKind[u.kind] = (byKind[u.kind] || 0) + 1;
      console.log(`  imported: mode=${save.mode ?? "classic"} star=${save.star} money=${save.money} minutes=${save.minutes}`);
      console.log(`  rooms=${rooms.length} transports=${(save.transports || []).length} byKind=${JSON.stringify(byKind)}`);
      // The ImportReport carries broughtOver + couldNotBring (both string[]);
      // the fidelity gaps are couldNotBring.
      const notes = report?.couldNotBring ?? [];
      console.log(`  import report: ${notes.length} fidelity note(s)${notes.length ? " -> " + notes.slice(0, 6).join(" | ") : ""}`);
      const out = input.replace(/\.tdt$/i, "") + ".imported.vctower";
      writeFileSync(out, toVctower(save));
      console.log(`  -> ${basename(out)}`);
    } catch (e) {
      console.error(`  IMPORT FAILED (${basename(input)}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (diffEmpty) {
    console.log(`\n== DIFF: our empty-tower export vs ${basename(inputs[0])} (real empty save) ==`);
    const emptySave = {
      version: SAVE_VERSION, seed: 1, money: 2_000_000, star: 1, minutes: 0,
      mode: "classic", units: [], transports: [], nextId: 1,
      towerName: "Empty", builtWeddingHall: false, evaluatedTower: false,
    };
    const ours = buildTDT(emptySave as SerializedGame).bytes;
    const real = new Uint8Array(readFileSync(inputs[0]));
    console.log(`  our export: ${ours.length} bytes | real: ${real.length} bytes | delta: ${ours.length - real.length}`);
    const n = Math.min(ours.length, real.length);
    let firstDiff = -1, diffs = 0;
    for (let i = 0; i < n; i++) if (ours[i] !== real[i]) { if (firstDiff < 0) firstDiff = i; diffs++; }
    console.log(`  first differing byte: ${firstDiff >= 0 ? "0x" + firstDiff.toString(16) + " (" + firstDiff + ")" : "none in overlap"}; total differing bytes in overlap: ${diffs}`);
    if (firstDiff >= 0) {
      const a = Math.max(0, firstDiff - 4), b = Math.min(n, firstDiff + 12);
      const hex = (arr: Uint8Array) => [...arr.slice(a, b)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
      console.log(`  @0x${a.toString(16)}  ours: ${hex(ours)}`);
      console.log(`  @0x${a.toString(16)}  real: ${hex(real)}`);
    }
  }
}

main();
