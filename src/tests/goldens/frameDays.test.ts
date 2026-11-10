import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_DAY_FIXTURE,
  FIRST_FRAME_CHECKPOINT,
  FRAME_DAY_CASES,
  FRAME_DAY_FIXTURES,
  MIN_DAY_CHECKPOINTS,
  SETUP_CHECKPOINTS,
  dumpRoot,
  firstFrameDayDifference,
  frameDayProblems,
  freshDumpDir,
  readFrameDays,
  type FrameDayCase,
  type FrameDayCheckpoint,
} from "./frameDays";

const at = (minute: number, state = "s", count = 0): FrameDayCheckpoint => ({ minute, state, crowd: "c", events: "e", count });

describe("the frame-day golden's comparison", () => {
  it("agrees on equal runs and names the first checkpoint and field that moved", () => {
    const want = [at(0), at(60), at(120)];
    expect(firstFrameDayDifference([at(0), at(60), at(120)], want)).toBeNull();
    expect(firstFrameDayDifference([at(0), at(60, "x"), at(121, "y")], want)).toBe("checkpoint 1 (minute 60): state x != pinned s");
    expect(firstFrameDayDifference([at(0), at(61, "s", 2)], want)).toBe("checkpoint 1 (minute 60): minute 61 != pinned 60, count 2 != pinned 0");
  });

  it("names a missing or extra checkpoint and a case the golden lacks", () => {
    const want = [at(0), at(60)];
    expect(firstFrameDayDifference([at(0)], want)).toBe("checkpoint 1: missing (ran 1, pinned 2)");
    expect(firstFrameDayDifference([at(0), at(60), at(120)], want)).toBe("checkpoint 2: extra (ran 3, pinned 2)");
    expect(firstFrameDayDifference([at(0)], undefined)).toBe("the golden has no entry for this case");
  });

  it("calls a case thin when it is short, frozen, or the event day with no event", () => {
    const fixture = (file: string): FrameDayCase => ({ id: file, start: { kind: "fixture", file }, speed: 1, steadyClock: false, frameTimes: [1000 / 60] });
    // A day of hourly checkpoints whose views change at every one, with one
    // event: in the first checkpoint of play unless `eventAt` moves it.
    const moving = (eventAt = SETUP_CHECKPOINTS, length = MIN_DAY_CHECKPOINTS) =>
      Array.from({ length }, (_, i): FrameDayCheckpoint => ({ minute: i * 60, state: `s${i}`, crowd: `c${i}`, events: "e", count: i === eventAt ? 1 : 0 }));
    const n = MIN_DAY_CHECKPOINTS;
    expect(frameDayProblems(fixture(EVENT_DAY_FIXTURE), moving())).toEqual([]);
    expect(frameDayProblems(fixture("other.vctower"), moving().map((p) => ({ ...p, state: "s" })))).toEqual([`the state view has only 1 distinct hash over ${n} checkpoints`]);
    expect(frameDayProblems(fixture("other.vctower"), moving().map((p) => ({ ...p, crowd: "c" })))).toEqual([`the crowd view has only 1 distinct hash over ${n} checkpoints`]);
    expect(frameDayProblems(fixture(EVENT_DAY_FIXTURE), moving().map((p) => ({ ...p, count: 0 })))).toEqual(["no event during play"]);
    // An event in the first frame's checkpoint belongs to the setup, so it
    // does not count as play.
    expect(frameDayProblems(fixture(EVENT_DAY_FIXTURE), moving(FIRST_FRAME_CHECKPOINT))).toEqual(["no event during play"]);
    expect(frameDayProblems(fixture("other.vctower"), moving().slice(0, 3))).toEqual([`3 checkpoints, fewer than ${n}`, "spans 120 minutes, less than a day"]);
    expect(frameDayProblems(fixture("other.vctower"), moving().slice(0, n - 1))).toEqual([`${n - 1} checkpoints, fewer than ${n}`]);
    // The edges: a view distinct at only half the checkpoints is still thin
    // and one more distinct hash is enough, at an even or an odd count; a day
    // to the minute, measured from the first checkpoint, is enough.
    const half = n / 2;
    expect(frameDayProblems(fixture("other.vctower"), moving().map((p, i) => ({ ...p, state: `s${Math.floor(i / 2)}` })))).toEqual([`the state view has only ${half} distinct hashes over ${n} checkpoints`]);
    expect(frameDayProblems(fixture("other.vctower"), moving().map((p, i) => ({ ...p, state: `s${Math.min(i, half)}` })))).toEqual([]);
    expect(frameDayProblems(fixture("other.vctower"), moving(SETUP_CHECKPOINTS, n + 1).map((p, i) => ({ ...p, state: `s${Math.min(i, half)}` })))).toEqual([]);
    const day = 24 * 60;
    expect(frameDayProblems(fixture("other.vctower"), moving().map((p) => ({ ...p, minute: Math.min(p.minute, day) })))).toEqual([]);
    expect(frameDayProblems(fixture("other.vctower"), moving().map((p) => ({ ...p, minute: Math.min(p.minute, day - 1) })))).toEqual([`spans ${day - 1} minutes, less than a day`]);
    expect(frameDayProblems(fixture("other.vctower"), moving().map((p) => ({ ...p, minute: 420 + Math.min(p.minute, day - 1) })))).toEqual([`spans ${day - 1} minutes, less than a day`]);
  });
});

describe("the frame-day cases", () => {
  it("cover every fixture at every running speed, plus the dual run's own cases", () => {
    for (const file of FRAME_DAY_FIXTURES) {
      const speeds = FRAME_DAY_CASES.filter((c) => c.start.kind === "fixture" && c.start.file === file && !c.steadyClock && c.frameTimes.length > 1).map((c) => c.speed);
      expect(speeds, file).toEqual([1, 2, 3]);
    }
    expect(FRAME_DAY_FIXTURES.length).toBeGreaterThanOrEqual(8);
    const modes = FRAME_DAY_CASES.flatMap((c) => (c.start.kind === "found" ? [`${c.start.mode} ${c.start.calendar}`] : []));
    expect(modes).toEqual(["classic realWorld", "modern realWorld", "modern canon"]);
    expect(FRAME_DAY_CASES.some((c) => c.steadyClock)).toBe(true);
    expect(FRAME_DAY_CASES.some((c) => c.frameTimes.length === 1)).toBe(true);
    // The two cases that name a fixture name one that is there.
    for (const c of FRAME_DAY_CASES) if (c.start.kind === "fixture") expect(FRAME_DAY_FIXTURES, c.id).toContain(c.start.file);
  });

  it("are the cases the committed golden pins, in order", () => {
    expect(Object.keys(readFrameDays().cases)).toEqual(FRAME_DAY_CASES.map((c) => c.id));
  });

  it("pin a moving tower: a full day per case, a state and crowd that change over every fixture's day, and the event day's events", () => {
    const golden = readFrameDays();
    expect(FRAME_DAY_FIXTURES, "the event day's fixture").toContain(EVENT_DAY_FIXTURE);
    for (const c of FRAME_DAY_CASES) expect(frameDayProblems(c, golden.cases[c.id]), c.id).toEqual([]);
  });
});

describe("the dump folders", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vc-dump-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("open a new or empty folder, and refuse one an earlier run left files in without touching its files", () => {
    expect(freshDumpDir(root, "new")).toBe(join(root, "new"));
    mkdirSync(join(root, "empty"));
    expect(freshDumpDir(root, "empty")).toBe(join(root, "empty"));
    const earlier = join(root, "earlier");
    mkdirSync(earlier);
    writeFileSync(join(earlier, "day.json"), "{}");
    expect(() => freshDumpDir(root, "earlier")).toThrow("already holds files");
    expect(readdirSync(earlier)).toEqual(["day.json"]);
  });

  it("empty a folder this test file opened when a run plays its case again", () => {
    const dir = freshDumpDir(root, "again");
    writeFileSync(join(dir, "line-1.json"), "{}");
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "line-2.json"), "{}");
    expect(freshDumpDir(root, "again")).toBe(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("are no folder when the variable is unset, empty or blank", () => {
    for (const blank of [undefined, "", "  ", "\t\n"]) expect(dumpRoot(blank), JSON.stringify(blank)).toBeUndefined();
    expect(dumpRoot(" dumps ")).toBe("dumps");
  });

  // Each golden's module reads its dump variable once, at import, and throws
  // when it names a folder but no case. A blank variable that passes that
  // check is no folder, so the run dumps nothing.
  it("are off for a blank VC_FRAME_DAYS_DUMP or VC_PORT_EDITS_DUMP, and need a case for a folder", async () => {
    const goldens = [
      { dump: "VC_FRAME_DAYS_DUMP", caseVar: "VC_FRAME_DAYS_CASE", load: () => import("./frameDays") },
      { dump: "VC_PORT_EDITS_DUMP", caseVar: "VC_PORT_EDITS_CASE", load: () => import("./portEditCases") },
    ];
    for (const g of goldens) {
      vi.stubEnv(g.caseVar, undefined);
      for (const blank of ["", "  "]) {
        vi.stubEnv(g.dump, blank);
        vi.resetModules();
        await expect(g.load(), `${g.dump}=${JSON.stringify(blank)}`).resolves.toBeDefined();
      }
      vi.stubEnv(g.dump, root);
      vi.resetModules();
      await expect(g.load(), `${g.dump} names a folder`).rejects.toThrow(`${g.dump} needs ${g.caseVar}`);
      vi.unstubAllEnvs();
    }
    expect(readdirSync(root), "no import opened a dump folder").toEqual([]);
  });
});
