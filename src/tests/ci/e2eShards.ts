/**
 * How the general browser suite (the `chromium` Playwright project) splits
 * across the e2e-general shards in test.yml (`scripts/e2e-shards.ts` runs
 * this on each shard).
 *
 * Playwright's own `--shard` splits by test count, and the slow specs (the
 * engine install and repair specs, the Map, the movable windows) sat next to
 * each other, so two shards took about 7 minutes while the third took 3.
 * This splits by measured time instead: each spec file goes, longest first,
 * to the shard with the least time so far (the longest-processing-time
 * rule), using the seconds in `e2eShardSeconds.json`.
 *
 * The split covers every file by construction: the files come from
 * Playwright's own `--list` on the shard (the same config and filters it
 * then runs), and each file lands in exactly one shard. A stale or missing
 * time only moves the balance, never what runs. A file with no measured time
 * counts {@link UNMEASURED_SECONDS_PER_TEST} seconds a test.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */

/** A spec file in the list, with how many tests it runs there. */
export interface ListedFile {
  readonly file: string;
  readonly tests: number;
}

export interface Shard {
  /** The spec files, in the order Playwright lists them. */
  readonly files: readonly string[];
  /** The measured (or estimated) seconds the files take together. */
  readonly seconds: number;
}

/** About the mean of a measured test in the general suite (894 s over 158 tests). */
export const UNMEASURED_SECONDS_PER_TEST = 6;

/** The seconds a file is expected to take: its measured time, or an estimate from its test count. */
export function fileSeconds(
  file: ListedFile,
  measured: Readonly<Record<string, number>>,
): number {
  const seconds = measured[file.file];
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : file.tests * UNMEASURED_SECONDS_PER_TEST;
}

/**
 * Splits the files into `total` shards of about equal time. The result is
 * the same for the same input, so every shard computes the same split.
 * Throws when there are fewer files than shards (a shard would run nothing)
 * or a file is listed twice.
 */
export function planShards(
  files: readonly ListedFile[],
  total: number,
  measured: Readonly<Record<string, number>>,
): Shard[] {
  if (!Number.isInteger(total) || total < 1)
    throw new Error(
      `the shard total must be a whole number above 0, not ${total}`,
    );
  const seen = new Set<string>();
  for (const { file } of files) {
    if (seen.has(file)) throw new Error(`${file} is listed twice`);
    seen.add(file);
  }
  if (files.length < total)
    throw new Error(`${files.length} spec files cannot fill ${total} shards`);

  const order = new Map(files.map(({ file }, index) => [file, index]));
  const byTime = files
    .map((file) => ({ file: file.file, seconds: fileSeconds(file, measured) }))
    .sort(
      (a, b) =>
        b.seconds - a.seconds ||
        (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0),
    );
  const shards = Array.from({ length: total }, () => ({
    files: [] as string[],
    seconds: 0,
  }));
  for (const { file, seconds } of byTime) {
    let lightest = shards[0];
    for (const shard of shards)
      if (shard.seconds < lightest.seconds) lightest = shard;
    lightest.files.push(file);
    lightest.seconds += seconds;
  }
  for (const shard of shards)
    shard.files.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return shards;
}

interface ListedSuite {
  readonly file?: string;
  readonly specs?: readonly { readonly tests?: readonly unknown[] }[];
  readonly suites?: readonly ListedSuite[];
}

function countTests(suite: ListedSuite): number {
  let tests = 0;
  for (const spec of suite.specs ?? []) tests += spec.tests?.length ?? 0;
  for (const child of suite.suites ?? []) tests += countTests(child);
  return tests;
}

/**
 * The spec files in Playwright's JSON report of a `--list` run, with their
 * test counts. A file with no test left after the filters is left out, as
 * Playwright would run nothing from it.
 */
export function listedFiles(report: {
  readonly suites?: readonly ListedSuite[];
}): ListedFile[] {
  const files: ListedFile[] = [];
  for (const suite of report.suites ?? []) {
    if (typeof suite.file !== "string" || suite.file === "")
      throw new Error("a listed suite has no file");
    const tests = countTests(suite);
    if (tests > 0) files.push({ file: suite.file, tests });
  }
  return files;
}

/** The units Playwright prints a test's duration in. */
const SECONDS_PER_UNIT: Readonly<Record<string, number>> = {
  ms: 0.001,
  s: 1,
  m: 60,
};

/**
 * Seconds per spec file from the output of Playwright's `list` reporter
 * (the CI logs of a run), for refreshing `e2eShardSeconds.json`. Each
 * finished test line ends in its duration; a retried test counts each try.
 */
export function measuredSeconds(
  logs: readonly string[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  const line =
    /\[chromium\] › (?:e2e\/)?([^:\s]+\.spec\.ts):\d+:\d+ › .*\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;
  for (const log of logs) {
    for (const text of log.split("\n")) {
      const match = line.exec(text);
      if (!match) continue;
      const [, file, amount, unit] = match;
      totals[file] =
        (totals[file] ?? 0) + Number(amount) * SECONDS_PER_UNIT[unit];
    }
  }
  return totals;
}
