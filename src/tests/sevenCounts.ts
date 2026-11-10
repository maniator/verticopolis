import { posix } from "node:path";

/** Each count the register's section 7 gives, as the code holds it: the
 *  exclusion ratchet's `itTypeScriptOnly` marks and `atEngineFrameCadence`
 *  calls with the files holding each and its `onWasmParityProject` branches,
 *  the files on the TypeScript engine ratchet and the test files among them,
 *  and the converted suites. */
export interface SevenCounts {
  readonly marks: number;
  readonly markFiles: number;
  readonly cadence: number;
  readonly cadenceFiles: number;
  readonly branches: number;
  readonly tsEngine: number;
  readonly tsEngineTests: number;
  readonly converted: number;
}

const EXCLUSIONS = "src/tests/parity/exclusions.ratchet.txt";
const TS_ENGINE = "src/tests/tsEngineTests.ratchet.txt";
const CONVERTED = "src/tests/portKit/converted.txt";

/** Where section 7 gives each count, what it counts, and the file that holds
 *  it. A pattern with two groups gives a split, whose parts must add up to
 *  the count, and "no" reads as 0. */
export const SEVEN_COUNTS: readonly (readonly [keyof SevenCounts, RegExp, string, string])[] = [
  ["marks", /\b(\d+)\s+`itTypeScriptOnly`\s+marks\b/, "`itTypeScriptOnly` marks", EXCLUSIONS],
  ["markFiles", /`itTypeScriptOnly`\s+marks\s+in\s+(\d+)\s+files\b/, "files with `itTypeScriptOnly` marks", EXCLUSIONS],
  ["cadence", /\b(\d+)\s+`atEngineFrameCadence`\s+calls\b/, "`atEngineFrameCadence` calls", EXCLUSIONS],
  ["cadenceFiles", /`atEngineFrameCadence`\s+calls\s+in\s+(\d+)\s+files\b/, "files with `atEngineFrameCadence` calls", EXCLUSIONS],
  ["branches", /\b(no|\d+)\s+`onWasmParityProject`\s+branches\b/, "`onWasmParityProject` branches", EXCLUSIONS],
  ["marks", /\*\*(\d+)\s+tests\*\*[\s\S]*?\*\*(\d+)\s+tests\*\*/, "marks in the two groups", EXCLUSIONS],
  ["tsEngineTests", /\((\d+)\s+test\s+files\s+and\s+\d+\s+fixtures\b/, "test files", TS_ENGINE],
  ["tsEngine", /\((\d+)\s+test\s+files\s+and\s+(\d+)\s+fixtures\b/, "test files and fixtures", TS_ENGINE],
  ["tsEngine", /`src\/tests\/tsEngineTests\.ratchet\.txt`\s+lists\s+(\d+)\s+files\b/, "files", TS_ENGINE],
  ["converted", /`src\/tests\/portKit\/converted\.txt`\s+lists\s+(\d+)\s+suites\b/, "suites", CONVERTED],
];

const lines = (text: string): string[] => text.split("\n").filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));
/** Each exclusion ratchet line's count of `name`, NaN where the line lacks
 *  it (the ratchet's own parser requires every field), so a renamed field
 *  fails the count instead of reading as 0. */
const field = (read: (rel: string) => string, name: string): number[] =>
  lines(read(EXCLUSIONS)).map((l) => Number(new RegExp(`\\b${name}=(\\d+)`).exec(l)?.[1] ?? NaN));

/** The files the exclusion ratchet gives `itTypeScriptOnly` marks, by their
 *  names less `.integration.test.ts` or `.test.ts`, as section 7's groups name them. */
export function markedStems(read: (rel: string) => string): string[] {
  const marks = field(read, "itTypeScriptOnly");
  const marked = lines(read(EXCLUSIONS)).filter((_, i) => marks[i] > 0);
  return marked.map((l) => posix.basename(l.trim().split(/\s+/)[0]).replace(/(\.integration)?\.test\.ts$/, ""));
}

/** {@link SevenCounts} from the files `read` returns by repository path. */
export function sevenCounts(read: (rel: string) => string): SevenCounts {
  const list = (rel: string): string[] => lines(read(rel));
  const [marks, cadence, branches] = [field(read, "itTypeScriptOnly"), field(read, "atEngineFrameCadence"), field(read, "onWasmParityProject")];
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  return {
    marks: sum(marks),
    markFiles: marks.filter((n) => n > 0).length,
    cadence: sum(cadence),
    cadenceFiles: cadence.filter((n) => n > 0).length,
    branches: sum(branches),
    tsEngine: list(TS_ENGINE).length,
    tsEngineTests: list(TS_ENGINE).filter((l) => /\.test\.ts$/.test(l.trim().split(/\s+/)[0])).length,
    converted: list(CONVERTED).length,
  };
}
