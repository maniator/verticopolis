import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Port-contract guard for `exportRecord`'s byte-capture obligation (GH #774).
 *
 * The shell's half of the export lives across a repo boundary, so the only
 * thing this repo can hold onto is the prose that states what a conforming
 * shell owes. `isSaveStorePort` is a shape check and says so, so nothing else
 * here would notice if these paragraphs were dropped in a cleanup pass and the
 * next shell author read a contract that no longer asked for any of it.
 *
 * The party that ruled on GH #774 ratified an in-memory capture at invocation
 * and rejected the on-disk staging variant by name (it would put a second
 * transient artifact class beside the cloud-sync root, and quitting during an
 * open dialog would orphan it). That ruling is only enforceable as text here,
 * so this test pins the text. Same posture as `backlogIssueMirror.test.ts`.
 *
 * Two properties this guard has to have, both learned the hard way:
 *
 *  - It reads only the doc block attached to `exportRecord`. A file-wide
 *    search passed with the member and its doc deleted outright, as long as
 *    the phrases survived in some unrelated comment elsewhere in the file,
 *    which is the failure the paragraph above says it prevents.
 *  - It fails loudly when that block cannot be found. A locator that quietly
 *    matched nothing would check nothing.
 *
 * It pins WORDING, not meaning, so an honest rewrite of the contract breaks
 * CI until the phrases here are updated to match. That is on purpose: for a
 * cross-repo obligation, "you changed the contract, come say so" is the point
 * of the guard.
 */

const SAVE_STORE = resolve(dirname(fileURLToPath(import.meta.url)), "../platform/saveStore.ts");

/** Phrases the contract must keep. Whitespace-insensitive, because the doc
 *  comment reflows: the wording is the invariant, the line breaks are not. */
const REQUIRED = [
  "Capture the record's BYTES at call time, BEFORE showing the dialog.",
  "Hold that capture in the shell's process memory.",
  "The shell must not create an on-disk staging or temp copy of the record for this purpose",
  "Show the dialog MODAL to the game window",
];

/**
 * The doc comment attached to `exportRecord`, as one whitespace-normalized
 * line with the comment furniture stripped.
 *
 * The inner `(?!\*\/)` is what keeps this scoped: without it the leftmost
 * `/**` in the file would match and the block would swallow everything up to
 * the member.
 */
function exportRecordDoc(source: string): string {
  const match = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*exportRecord\?\(/.exec(source);
  if (match === null) {
    throw new Error(
      "No doc comment found immediately above `exportRecord?(` in saveStore.ts. " +
        "If the member was renamed or its doc detached, this guard is checking nothing: fix the locator.",
    );
  }
  return match[1].replace(/^\s*\*\s?/gm, "").replace(/\s+/g, " ");
}

describe("exportRecord port contract (GH #774)", () => {
  it("states the byte-capture obligation and its in-memory form", () => {
    const doc = exportRecordDoc(readFileSync(SAVE_STORE, "utf8"));
    const missing = REQUIRED.filter((phrase) => !doc.includes(phrase.replace(/\s+/g, " ")));
    expect(missing).toEqual([]);
  });

  it("reads only exportRecord's own doc, not the rest of the file", () => {
    // The mutation this replaces a file-wide `includes` for: delete the member
    // and its doc, park the obligations in a historical note at the top, and a
    // file-wide search still passes while the contract says nothing.
    const relocated = [
      "/** Historical note: we once asked shells to",
      ` * ${REQUIRED[0]} ${REQUIRED[1]}`,
      " */",
      "const legacy = 1;",
      "/** Export a stored record. */",
      "exportRecord?(id: string): Promise<boolean>;",
    ].join("\n");
    const doc = exportRecordDoc(relocated);
    expect(doc.trim()).toBe("Export a stored record.");
    expect(REQUIRED.filter((phrase) => doc.includes(phrase))).toEqual([]);
  });

  it("throws rather than passing vacuously when the doc block is gone", () => {
    expect(() => exportRecordDoc("exportRecord?(id: string): Promise<boolean>;")).toThrow(/checking nothing/);
  });
});
