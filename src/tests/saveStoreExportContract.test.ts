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

describe("exportRecord port contract (GH #774)", () => {
  it("states the byte-capture obligation and its in-memory form", () => {
    // Strip the comment furniture so the phrases can be matched as prose.
    const doc = readFileSync(SAVE_STORE, "utf8")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ");
    const missing = REQUIRED.filter((phrase) => !doc.includes(phrase.replace(/\s+/g, " ")));
    expect(missing).toEqual([]);
  });
});
