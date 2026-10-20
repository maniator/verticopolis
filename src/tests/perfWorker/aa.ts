import type { ModeName } from "./pageWorker";

/**
 * `perf:worker --aa ts|wasm` (#1111): an A/A pass, the same mode in both
 * slots, on the terms of `perf:compare --aa`. The two slots are labelled
 * "ts" and "wasm" so every table keeps its shape (slot "wasm" over slot "ts"),
 * and the process run records the slot and the mode it actually ran. The
 * pass is the A/A source for M4's long-task tolerance (benchmark-protocol.md
 * section 6.1); it measures nothing on its own and sets no tolerance.
 */
export const AA_SLOTS: readonly ModeName[] = ["ts", "wasm"];

export type AaMode = "ts" | "wasm";

const NAME = { ts: "TypeScript", wasm: "WASM main-thread host" } as const;

/** The value after `--aa`, or an error that names the choices. */
export function parseAa(v: string): AaMode {
  if (v !== "ts" && v !== "wasm") throw new Error("--aa takes the mode to run in both slots: ts or wasm");
  return v;
}

/**
 * An explicit `--out` folder for an A/A pass names its mode (`aa-ts` or
 * `aa-wasm`), so it cannot be mistaken for a comparison; a comparison's
 * folder must not name one. Only the folder's own name counts, in lower case,
 * because results are written on case-insensitive disks too.
 */
export function checkAaFolder(name: string, aa: AaMode | null): void {
  const lower = name.toLowerCase();
  if (aa) {
    const other = aa === "ts" ? "wasm" : "ts";
    if (!lower.includes(`aa-${aa}`)) throw new Error(`--aa ${aa} needs an --out folder name containing aa-${aa}, so the folder cannot be mistaken for a comparison`);
    if (lower.includes(`aa-${other}`)) throw new Error(`--aa ${aa} cannot write to ${name}, which also names the aa-${other} marker`);
  } else if (/aa-(ts|wasm)/.test(lower)) throw new Error(`--out ${name} names an A/A folder, but this run is a comparison; pass --aa ts|wasm or pick another name`);
}

/** The report banner that leads an A/A folder. */
export const aaBanner = (aa: AaMode): string =>
  `> **A/A pass.** Both slots ran the ${NAME[aa]} mode. The "ts" and "wasm" labels below name the two slots, and every ratio is slot "wasm" over slot "ts" (or the reverse where a column says so). This folder is one input to the M4 long-task tolerance in benchmark-protocol.md section 6.1. No tolerance is read off one folder, and there is no verdict: the intervals are the data.`;

/** The limitation that opens an A/A folder's list. */
export const aaLimitation = (aa: AaMode): string =>
  `An A/A pass: the ${NAME[aa]} mode ran in both slots. The wasm-frame and wasm-worker modes did not run, so their columns and the comparisons with them are absent. A slot's name is a label, not the mode that ran; each run records both.`;
