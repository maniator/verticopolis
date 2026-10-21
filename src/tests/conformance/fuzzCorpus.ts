/**
 * The fuzz corpus: scenarios the seeded differential once diverged on (and
 * smoke entries that keep the job from running on nothing), kept under
 * `conformance/fuzz-corpus/`. A pull request that touches either engine
 * replays every entry on both and fails if they disagree
 * (`scripts/fuzz-corpus.ts`). Corpus entries are not part of the locked
 * conformance suite: they have no pinned hashes, only the two engines' own
 * agreement.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CONFORMANCE_DIR } from "./scenario";

/** A corpus file name: lowercase words and digits joined by dashes. */
export const CORPUS_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const corpusDir = (): string => resolve(CONFORMANCE_DIR, "fuzz-corpus");

/** The corpus files, sorted. */
export function corpusFiles(): string[] {
  return readdirSync(corpusDir())
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => resolve(corpusDir(), f));
}
