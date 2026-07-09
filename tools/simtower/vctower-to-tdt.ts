// vctower -> .TDT converter for round-trip testing against the real SimTower.
//
// Decodes a .vctower container (magic line + base64 of DEFLATE-compressed JSON,
// see src/storage/SaveGame.ts) and runs the engine's own buildTDT() exporter to
// produce the .TDT bytes the retail game loads. It imports buildTDT directly
// (run via tsx, which strips the TypeScript in-process), so it exercises the
// exact engine module the app ships and cannot drift from it.
//
// Usage:
//   npx tsx tools/simtower/vctower-to-tdt.ts <in.vctower> [<in2.vctower> ...]
// Writes <NAME>.TDT into tools/simtower/saves/ (mounted into the game as C:\saves).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "fflate";
import { buildTDT } from "../../src/storage/tdtExport";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAVES = resolve(HERE, "saves");

function decodeVctower(path: string) {
  const text = readFileSync(path, "utf8");
  const nl = text.indexOf("\n");
  if (nl < 0) throw new Error(`${path}: not a .vctower file (no header line)`);
  const magic = text.slice(0, nl).trim();
  // Only VCTOWER1 is decoded below (base64 of DEFLATE JSON). Refuse other
  // versions loudly rather than mis-decode a future container format.
  if (magic !== "VCTOWER1")
    throw new Error(`${path}: unsupported .vctower version (magic="${magic}"; this tool decodes VCTOWER1)`);
  const b64 = text.slice(nl + 1).trim();
  const json = new TextDecoder("utf-8", { fatal: true }).decode(inflateSync(Buffer.from(b64, "base64")));
  return JSON.parse(json);
}

function main() {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error("usage: npx tsx tools/simtower/vctower-to-tdt.ts <in.vctower> [...]");
    process.exit(2);
  }
  mkdirSync(SAVES, { recursive: true });

  // A DOS 8.3 output name unique per input (the game browses C:\saves for
  // *.TDT). Prefer the trailing _<n> version in the input name, else an index.
  const outName = (input: string, i: number) => {
    const stem = basename(input).replace(/\.vctower$/i, "");
    const ver = /_(\d+)$/.exec(stem)?.[1];
    return `TOWER${ver ?? i + 1}`.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) + ".TDT";
  };

  for (const [i, input] of inputs.entries()) {
    // Wrap the WHOLE per-input body (decode included): a bad base64 / JSON /
    // magic on one file should skip that file, not abort the rest of the batch.
    try {
      const save = decodeVctower(input);
      const label = `${basename(input)}  [${save.towerName ?? "?"}, ${save.mode ?? "classic"} mode, ${save.star ?? "?"}★]`;
      const built = buildTDT(save);
      const name = outName(input, i);
      const out = resolve(SAVES, name);
      writeFileSync(out, built.bytes);
      console.log(`OK  ${label}\n    -> saves/${name} (${built.bytes.length} bytes; game filename ${built.report.filename})`);
      // The ExportReport carries comesAlong + staysBehind (both string[]);
      // staysBehind is what the .TDT format cannot represent.
      const behind = built.report?.staysBehind ?? [];
      if (behind.length)
        console.log(`    stays behind: ${behind.length} (${behind.slice(0, 3).join("; ")}${behind.length > 3 ? "; ..." : ""})`);
    } catch (e) {
      console.error(`SKIP ${basename(input)}\n    ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main();
