// Real-disc check for the disc reader: run on your own SimTower ISO, on your
// own machine. Prints names, sizes, hashes, counts, and the sentences our
// reader and importer write about a file; never the disc's bytes or its own
// text. Those sentences can quote a value read from a tower (a name, a count),
// so read the output before you paste it anywhere public. Writes nothing.
//
//   npm run disc:wasm:build
//   npx tsx tools/simtower/disc-check.ts /path/to/SimTower.iso [--kwajd /path/to/kwajd]
//
// It runs the reader with the limits the product ships with. For every file
// on the image it prints the stored size and, for KWAJ files, the expanded
// size against the size the KWAJ header declares and the sizes the disc's own
// setup manifest gives for that file (the numbers only, matched on the file's
// stored name or its expanded name: the stem and the extension's first two
// letters, so `SIMTOWER.EX_` matches `SIMTOWER.EXE`). For each executable it
// also prints the program kind (16-bit NE, 32-bit PE, DOS) from the header
// fields alone. With --kwajd (the harness's libmspack wrapper,
// tools/simtower/docker/kwajd.c built with `cc kwajd.c -lmspack`) it also
// expands each KWAJ file with libmspack and reports whether the two agree,
// including when we refuse a file libmspack expands.
//
// Then every tower (.TDT, or the compressed .TD_) goes through the game's own
// importer (looksLikeLegacyTower + parseTDT) and the tool prints counts: units
// by kind, transports by kind, and the import report's notes (our importer's
// own sentences). These are the counts the open TDT backlog rows wait on
// (#740, #737, #739).
//
// Clean-room: the ISO and everything expanded from it stay in memory or a
// temporary directory that is removed before exit. Nothing is written to the
// repository; paste the printed output, never the files.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { DiscRefused, hasDiscWasm, openDiscFd, type DiscEntry, type WasmDisc } from "../../src/tests/disc/wasmDisc";
import { parseTDT } from "../../src/storage/tdtImport";
import { looksLikeLegacyTower } from "../../src/storage/tdtImportHelpers";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const tally = (items: string[]) => {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return JSON.stringify(out);
};

/** A reason to stop with usage text. Thrown, never `process.exit`, so the
 *  cleanup in `main`'s `finally` always runs. */
class Usage extends Error {}

function usage(why: string): never {
  throw new Usage(why);
}

function parseArgs(args: string[]): { iso: string; kwajd?: string } {
  let kwajd: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--kwajd") {
      const v = args[++i];
      if (!v || v.startsWith("--")) usage("--kwajd needs the path to a kwajd binary");
      kwajd = v;
    } else if (a.startsWith("--")) {
      usage(`unknown option ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) usage("give exactly one ISO file");
  return { iso: positional[0]!, kwajd };
}

/** libmspack's expansion, or why it gave none: a refusal (a nonzero exit)
 *  is reported apart from a crash, a hang or a missing output, which mean
 *  the oracle itself failed. */
function libmspack(kwajd: string, stored: Uint8Array, scratch: string): Uint8Array | string {
  const input = resolve(scratch, "in.kw_");
  const output = resolve(scratch, "out.bin");
  writeFileSync(input, stored);
  try {
    const run = spawnSync(kwajd, [input, output], { stdio: "pipe", timeout: 60_000 });
    if (run.error) return `ORACLE FAILED (${run.error.message})`;
    if (run.signal) return `ORACLE FAILED (killed by ${run.signal})`;
    if (run.status !== 0) return "refused";
    try {
      return new Uint8Array(readFileSync(output));
    } catch {
      return "ORACLE FAILED (it exited cleanly but wrote no output)";
    }
  } finally {
    rmSync(input, { force: true });
    rmSync(output, { force: true });
  }
}

/** Our read of an entry, or the refusal (printed by the caller). */
function ours(disc: WasmDisc, e: DiscEntry): Uint8Array | DiscRefused {
  try {
    return disc.read(e.token).bytes;
  } catch (err) {
    if (err instanceof DiscRefused) return err;
    throw err;
  }
}

/** For each word-like name in a manifest, the numbers on its lines. Only the
 *  numbers leave this function; the manifest's text is never printed. */
function manifestSizes(text: string): Map<string, number[]> {
  const sizes = new Map<string, number[]>();
  for (const line of text.split(/\r?\n/)) {
    // Digits right after a dot belong to a file name (`DVA.386`), not a size.
    const numbers = [...line.matchAll(/(?<!\.)\b\d{3,}\b/g)].map((m) => Number(m[0]));
    if (!numbers.length) continue;
    for (const m of line.toUpperCase().matchAll(/\b[A-Z0-9_$~-]{1,8}(?:\.[A-Z0-9_$~-]{1,3})?\b/g)) {
      const name = m[0];
      sizes.set(name, [...(sizes.get(name) ?? []), ...numbers]);
    }
  }
  return sizes;
}

/** The names a KWAJ file may be listed under in a manifest: as stored
 *  (`SIMTOWER.EX_`), or expanded, which by the format's naming convention
 *  keeps the stem and the extension's first two letters (`SIMTOWER.EXE`).
 *  A sibling such as `SIMTOWER.HLP` does not match `SIMTOWER.MS_`. */
function lookup(sizes: Map<string, number[]>, path: string): number[] {
  const stored = basename(path).toUpperCase();
  const dot = stored.lastIndexOf(".");
  const stem = dot === -1 ? stored : stored.slice(0, dot);
  const ext = dot === -1 ? "" : stored.slice(dot + 1);
  const expanded = ext.length === 3 && ext.endsWith("_") ? new RegExp(`^${escapeRegExp(stem)}\\.${escapeRegExp(ext.slice(0, 2))}.$`) : undefined;
  const found = new Set<number>();
  for (const [name, nums] of sizes) {
    if (name === stored || expanded?.test(name)) for (const n of nums) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What kind of program an executable is, from its header fields only: the
 *  DOS stub's `MZ`, then the signature the stub points at (16-bit `NE`,
 *  32-bit `PE`, or `LE`/`LX` for VxDs and DOS extenders). */
function programKind(bytes: Uint8Array): string {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return "not an MZ executable";
  const at = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0x3c, true);
  const sig = at + 4 <= bytes.length ? String.fromCharCode(bytes[at]!, bytes[at + 1]!) : "";
  if (sig === "PE" && bytes[at + 2] === 0 && bytes[at + 3] === 0) return "32-bit Windows (PE)";
  if (sig === "NE") return "16-bit Windows (NE)";
  if (sig === "LE" || sig === "LX") return `${sig} executable (VxD or DOS extender)`;
  return "DOS program (no Windows header)";
}

function main() {
  const { iso, kwajd } = parseArgs(process.argv.slice(2));
  if (!hasDiscWasm()) usage("the disc reader is not built; run npm run disc:wasm:build first");
  const notAFile = `${iso} is not a regular file; give the path of an .iso image of the disc (a drive device cannot be read directly)`;
  let fd: number;
  try {
    // Checked before the open, since opening a pipe or a device can block.
    if (!statSync(iso).isFile()) usage(notAFile);
    fd = openSync(iso, "r");
  } catch (err) {
    if (err instanceof Usage) throw err;
    usage(`cannot open ${iso}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const scratch = mkdtempSync(resolve(tmpdir(), "vc-disc-check-"));
  let disc: WasmDisc | undefined;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) usage(notAFile); // swapped since the check above
    disc = openDiscFd(fd, stat.size);
    const { entries } = disc.opened();
    console.log(`${basename(iso)}: ${entries.length} files (shipping limits)`);

    // Every manifest, plain or KWAJ-compressed (SETUP.IN_), read for numbers.
    const sizes = new Map<string, number[]>();
    for (const m of entries.filter((e) => /\.(INF|IN_|LST|LS_)$/.test(e.path))) {
      const got = ours(disc, m);
      if (got instanceof DiscRefused) {
        console.log(`  manifest ${m.path} refused: ${got.refusal.code}`);
        continue;
      }
      for (const [name, nums] of manifestSizes(new TextDecoder("latin1").decode(got))) {
        sizes.set(name, [...(sizes.get(name) ?? []), ...nums]);
      }
    }

    const towers: { name: string; bytes: Uint8Array }[] = [];
    console.log("\n== files ==");
    for (const e of entries) {
      const head = `  ${e.path.padEnd(28)} stored ${String(e.size).padStart(9)}`;
      if (e.stored !== "kwaj") {
        console.log(`${head}${e.stored === "unreadable" ? "  UNREADABLE (its extent lies outside the image, its record uses a layout the reader does not support, or its endian halves disagree)" : ""}`);
        if (e.stored === "plain" && /\.(EXE|DLL)$/.test(e.path)) {
          try {
            console.log(`    program: ${programKind(disc.readStored(e.token))}`);
          } catch (err) {
            if (!(err instanceof DiscRefused)) throw err;
            console.log(`    program: unread, we refuse it (${err.refusal.code})`);
          }
        }
        if (e.stored === "plain" && /\.TDT$/.test(e.path)) {
          const got = ours(disc, e);
          if (got instanceof DiscRefused) console.log(`    we refuse: ${got.refusal.code} (${got.refusal.detail})`);
          else towers.push({ name: e.path, bytes: got });
        }
        continue;
      }
      console.log(`${head}  KWAJ method ${e.method ?? "?"}, header declares ${e.expandedSize ?? "(no length)"}`);
      const got = ours(disc, e);
      if (got instanceof DiscRefused) console.log(`    we refuse: ${got.refusal.code} (${got.refusal.detail})`);
      else console.log(`    ours: ${got.length} bytes, sha256 ${sha(got)}`);
      const listed = lookup(sizes, e.path);
      if (listed.length) {
        const verdict = got instanceof DiscRefused ? "" : listed.includes(got.length) ? " (ours matches one)" : " (OURS MATCHES NONE)";
        console.log(`    manifest sizes for this name: ${listed.join(", ")}${verdict}`);
      }
      let stored: Uint8Array | undefined;
      if (kwajd) {
        try {
          stored = disc.readStored(e.token);
        } catch (err) {
          if (!(err instanceof DiscRefused)) throw err;
          console.log(`    libmspack: skipped, we refuse to read the stored bytes (${err.refusal.code})`);
        }
      }
      if (kwajd && stored) {
        const theirs = libmspack(kwajd, stored, scratch);
        if (typeof theirs === "string" && theirs.startsWith("ORACLE FAILED")) console.log(`    libmspack: ${theirs}`);
        else if (typeof theirs === "string") console.log(`    libmspack: refused${got instanceof DiscRefused ? " (agrees)" : " (WE EXPAND, IT REFUSES)"}`);
        else if (got instanceof DiscRefused) console.log(`    libmspack: ${theirs.length} bytes, sha256 ${sha(theirs)} (WE REFUSE, IT EXPANDS)`);
        else if (sha(theirs) === sha(got)) console.log("    libmspack: identical");
        else {
          const common = theirs.findIndex((b, i) => b !== got[i]);
          const prefix = common === -1 ? Math.min(theirs.length, got.length) : common;
          console.log(`    libmspack: DIFFERS, ${theirs.length} bytes, sha256 ${sha(theirs)}, first ${prefix} bytes agree`);
          if (listed.length) console.log(`    manifest says ${listed.includes(theirs.length) ? "libmspack's" : "neither"} size${listed.includes(got.length) ? " and ours" : ""}`);
        }
      }
      if (!(got instanceof DiscRefused) && /\.(EX_|DL_)$/.test(e.path)) console.log(`    program: ${programKind(got)}`);
      if (!(got instanceof DiscRefused) && /\.TD_$/.test(e.path)) towers.push({ name: e.path.replace(/_$/, "T"), bytes: got });
    }

    console.log("\n== towers through the importer ==");
    if (!towers.length) console.log("  no towers on this image (no .TDT or .TD_ file)");
    for (const t of towers) {
      console.log(`  ${t.name} (${t.bytes.length} bytes)`);
      if (!looksLikeLegacyTower(basename(t.name), t.bytes)) {
        console.log("    not recognized as a tower");
        continue;
      }
      try {
        const copy = t.bytes.slice();
        const { save, report } = parseTDT(copy.buffer as ArrayBuffer, basename(t.name));
        const units = (save.units ?? []).filter((u) => u.kind !== "floor" && u.kind !== "lobby");
        console.log(`    star ${report.star}, floors ${report.floors}, basements ${report.basements}, units ${report.unitsImported}`);
        console.log(`    units by kind ${tally(units.map((u) => u.kind))}`);
        console.log(`    transports by kind ${tally((save.transports ?? []).map((x) => x.kind))}`);
        console.log(`    import report: ${report.couldNotBring.length} note(s)`);
        for (const note of report.couldNotBring) console.log(`      - ${note}`);
      } catch (err) {
        console.log(`    import refused: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    if (err instanceof DiscRefused) throw new Usage(`the disc reader refused the image: ${err.refusal.code} (${err.refusal.detail})`);
    throw err;
  } finally {
    disc?.free();
    closeSync(fd);
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  if (!(err instanceof Usage)) throw err;
  console.error(`${err.message}\nusage: npx tsx tools/simtower/disc-check.ts <SimTower.iso> [--kwajd <path>]`);
  process.exitCode = 2;
}
