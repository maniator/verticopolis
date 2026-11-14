import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import measured from "./e2eShardSeconds.json";
import {
  fileSeconds,
  listedFiles,
  measuredSeconds,
  planShards,
  UNMEASURED_SECONDS_PER_TEST,
} from "./e2eShards";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("planShards", () => {
  const files = [
    { file: "a.spec.ts", tests: 1 },
    { file: "b.spec.ts", tests: 1 },
    { file: "c.spec.ts", tests: 1 },
    { file: "d.spec.ts", tests: 1 },
    { file: "e.spec.ts", tests: 1 },
  ];
  const seconds = {
    "a.spec.ts": 10,
    "b.spec.ts": 50,
    "c.spec.ts": 30,
    "d.spec.ts": 20,
    "e.spec.ts": 40,
  };

  it("gives each file, longest first, to the shard with the least time so far", () => {
    // 50 -> 1, 40 -> 2, 30 -> 2 (40 < 50), 20 -> 1 (50 < 70), 10 -> 1 (70 = 70, first wins).
    expect(planShards(files, 2, seconds)).toEqual([
      { files: ["a.spec.ts", "b.spec.ts", "d.spec.ts"], seconds: 80 },
      { files: ["c.spec.ts", "e.spec.ts"], seconds: 70 },
    ]);
  });

  it("puts every listed file in exactly one shard", () => {
    for (const total of [1, 2, 3, 4, 5]) {
      const placed = planShards(files, total, seconds).flatMap(
        (shard) => shard.files,
      );
      expect(placed.slice().sort()).toEqual(files.map(({ file }) => file));
    }
  });

  it("keeps Playwright's list order inside a shard", () => {
    const [only] = planShards(files, 1, seconds);
    expect(only.files).toEqual([
      "a.spec.ts",
      "b.spec.ts",
      "c.spec.ts",
      "d.spec.ts",
      "e.spec.ts",
    ]);
  });

  it("breaks a tie between equal files by list order, so every shard computes the same split", () => {
    const even = files.map(({ file }) => ({ file, tests: 2 }));
    expect(planShards(even, 2, {})).toEqual([
      { files: ["a.spec.ts", "c.spec.ts", "e.spec.ts"], seconds: 36 },
      { files: ["b.spec.ts", "d.spec.ts"], seconds: 24 },
    ]);
  });

  it("refuses a split that would leave a shard with nothing to run", () => {
    expect(() => planShards(files.slice(0, 3), 4, seconds)).toThrow(
      "3 spec files cannot fill 4 shards",
    );
  });

  it("refuses a file listed twice", () => {
    expect(() => planShards([...files, files[0]], 2, seconds)).toThrow(
      "a.spec.ts is listed twice",
    );
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a shard total of %s", (total) => {
    expect(() => planShards(files, total, seconds)).toThrow(
      "the shard total must be a whole number above 0",
    );
  });
});

describe("fileSeconds", () => {
  it("uses the measured time when there is one", () => {
    expect(
      fileSeconds({ file: "a.spec.ts", tests: 9 }, { "a.spec.ts": 12 }),
    ).toBe(12);
  });

  it("estimates an unmeasured file from its test count", () => {
    expect(
      fileSeconds({ file: "new.spec.ts", tests: 3 }, { "a.spec.ts": 12 }),
    ).toBe(3 * UNMEASURED_SECONDS_PER_TEST);
  });

  it("estimates a file whose measured time is not a usable number", () => {
    const broken = { "a.spec.ts": -1, "b.spec.ts": Number.NaN } as Record<
      string,
      number
    >;
    expect(fileSeconds({ file: "a.spec.ts", tests: 2 }, broken)).toBe(
      2 * UNMEASURED_SECONDS_PER_TEST,
    );
    expect(fileSeconds({ file: "b.spec.ts", tests: 1 }, broken)).toBe(
      UNMEASURED_SECONDS_PER_TEST,
    );
  });
});

describe("listedFiles", () => {
  it("counts the tests in each file, nested describe blocks included", () => {
    const report = {
      suites: [
        { file: "a.spec.ts", specs: [{ tests: [{}] }, { tests: [{}] }] },
        {
          file: "b.spec.ts",
          specs: [],
          suites: [
            {
              specs: [{ tests: [{}] }],
              suites: [{ specs: [{ tests: [{}, {}] }] }],
            },
          ],
        },
      ],
    };
    expect(listedFiles(report)).toEqual([
      { file: "a.spec.ts", tests: 2 },
      { file: "b.spec.ts", tests: 3 },
    ]);
  });

  it("leaves out a file the filters emptied", () => {
    expect(
      listedFiles({
        suites: [
          { file: "perf.spec.ts", specs: [] },
          { file: "a.spec.ts", specs: [{ tests: [{}] }] },
        ],
      }),
    ).toEqual([{ file: "a.spec.ts", tests: 1 }]);
  });

  it("refuses a suite with no file", () => {
    expect(() =>
      listedFiles({ suites: [{ specs: [{ tests: [{}] }] }] }),
    ).toThrow("a listed suite has no file");
  });
});

describe("measuredSeconds", () => {
  it("adds up each file's test durations from a list reporter log", () => {
    const log = [
      "2026-11-13T21:50:43.7524014Z   ✓  29 [chromium] › e2e/saveRoundTrip.spec.ts:112:1 › an older version's autosave loads (7.0s)",
      "  ✓  30 [chromium] › e2e/saveRoundTrip.spec.ts:140:3 › a group › a test (500ms)",
      "  ✓  31 [chromium] › e2e/overviewMap.spec.ts:87:3 › a click (1.5m)",
      "  ✘  32 [chromium] › e2e/win.spec.ts:43:1 › a TOWER save (5.1s)",
      "  53 passed (7.1m)",
    ].join("\n");
    expect(measuredSeconds([log])).toEqual({
      "saveRoundTrip.spec.ts": 7.5,
      "overviewMap.spec.ts": 90,
      "win.spec.ts": 5.1,
    });
  });

  it("adds the logs of several shards together", () => {
    const one = "  ✓  1 [chromium] › e2e/a.spec.ts:1:1 › x (2s)";
    const two = "  ✓  1 [chromium] › e2e/a.spec.ts:9:1 › y (3s)";
    expect(measuredSeconds([one, two])).toEqual({ "a.spec.ts": 5 });
  });
});

describe("e2eShardSeconds.json", () => {
  it("names only spec files that exist, with times that are whole seconds", () => {
    for (const [file, seconds] of Object.entries(measured)) {
      expect(existsSync(join(root, "e2e", file)), file).toBe(true);
      expect(Number.isInteger(seconds) && seconds >= 0, file).toBe(true);
    }
  });

  it("splits into four shards within a tenth of each other", () => {
    const files = Object.keys(measured).map((file) => ({ file, tests: 1 }));
    const shards = planShards(files, 4, measured);
    const times = shards.map((shard) => shard.seconds);
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.1);
  });
});
