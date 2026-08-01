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
  const text = readFileSync(path, "utf8").trim();
  // Anchor on the magic itself rather than on a header LINE: the separating
  // newline is whitespace, and a file written without it loads in the game but
  // was refused here.
  //
  // The version digits cannot be read off by pattern alone. Base64 can start
  // with a digit, so with no separator "VCTOWER1" + "7Zt..." is equally
  // "VCTOWER17" + "Zt..."; a greedy `VCTOWER(\d+)` picks the second reading and
  // rejects a perfectly good v1 file as a version from the future (SaveGame.
  // import has that quirk, pinned by saveMigrationRun.test.ts, and a first
  // attempt at this fix inherited it, mislabeling roughly one separator-less
  // file in six). So DECODE to disambiguate: try v1, and only if those bytes
  // are not a v1 payload fall back to reporting the version the digits claim.
  if (!/^VCTOWER\d/.test(text)) throw new Error(`${path}: not a .vctower file (no VCTOWER magic)`);
  const asV1 = (): unknown => {
    const b64 = text.slice("VCTOWER1".length).replace(/\s+/g, "");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inflateSync(Buffer.from(b64, "base64"))));
  };
  if (/^VCTOWER1/.test(text)) {
    try {
      return asV1();
    } catch (e) {
      // Only a version OTHER than 1 can be hiding here, and only when the file
      // has no separator; with one, the digits are unambiguous and this is
      // simply a damaged v1 file.
      const claimed = /^VCTOWER(\d+)(?=\s|$)/.exec(text)?.[1];
      if (claimed !== undefined && claimed !== "1") {
        throw new Error(`${path}: unsupported .vctower version (VCTOWER${claimed}; this tool decodes VCTOWER1)`);
      }
      // Buffer.from(..., "base64") drops anything outside the alphabet instead
      // of failing, so a truncated or mangled container surfaces as a raw fflate
      // or JSON error. Wrap it so every failure carries its file. With no
      // separator the version is unknowable once the v1 read fails, so say both
      // things it could be rather than assert the wrong one.
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        claimed === undefined
          ? `${path}: unreadable .vctower (damaged, or a version after VCTOWER1 written without a separating newline): ${detail}`
          : `${path}: damaged .vctower payload (${detail})`,
      );
    }
  }
  const version = /^VCTOWER(\d+)/.exec(text)![1];
  throw new Error(`${path}: unsupported .vctower version (VCTOWER${version}; this tool decodes VCTOWER1)`);
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
