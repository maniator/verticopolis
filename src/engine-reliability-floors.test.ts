import { describe, expect, it } from "vitest";
// The stage floors (#1268): the owner's direction of 2026-10-21 counts the
// stage 1 and stage 2 floors in engaged sessions at their own stage.
import {
  STAGE_FLOORS,
  renderFloorsMarkdown,
  summarizeFloors,
} from "../scripts/engine-reliability-floors.mjs";
import {
  renderReliabilityMarkdown,
  summarizeReliability,
} from "../scripts/engine-reliability.mjs";
import { when } from "../scripts/engine-reliability-cohorts.mjs";
import { fault, life, run } from "./engine-reliability-cohorts.fixtures";

const stage1 = (over: Parameters<typeof life>[0] = {}) =>
  life({ stage: "1", ...over });
const floorAt = (lives: ReturnType<typeof life>[], stage: string) =>
  summarizeFloors(lives).find((f) => f.stage === stage)!;

describe("the stage floors", () => {
  it("names the owner's floors: 30 engaged sessions at stage 1, 100 at stage 2", () => {
    expect(STAGE_FLOORS).toEqual([
      { stage: "1", floor: 30 },
      { stage: "2", floor: 100 },
    ]);
  });

  it("counts a cohort-drawn, engaged WASM-arm session at its own stage, on any commit", () => {
    const f = floorAt(
      [
        stage1({ session: "a", sha: "1a10db3" }),
        stage1({ session: "b", sha: "4fd4b4e" }),
      ],
      "1",
    );
    expect(f.engaged.n).toBe(2);
    expect(f.attempts.n).toBe(2);
    expect(f.reached).toBe(false);
    // Stage 3 sessions are the eligible cohort's, never a floor's.
    expect(floorAt([life({ session: "c" })], "1").engaged.n).toBe(0);
    expect(floorAt([stage1({ session: "a" })], "2").engaged.n).toBe(0);
  });

  it("leaves out what the floor's unit excludes: no engagement, the TypeScript arm, a setting, a suppression, the old hosts", () => {
    const out = [
      stage1({ session: "never-engaged", engaged: false }),
      stage1({ session: "engaged-on-ts", engagedEngine: "ts" }),
      stage1({
        session: "ts-arm",
        assignedArm: "ts",
        requested: "ts",
        engagedEngine: "ts",
      }),
      stage1({ session: "setting", selectedBy: "setting" }),
      stage1({ session: "default", selectedBy: "default" }),
      stage1({
        session: "suppressed",
        selectedBy: "safety-device",
        requested: "ts",
      }),
      stage1({
        session: "marker",
        reasons: ["marker-blocked"],
        settleFallbacks: 1,
        fallbacks: 1,
      }),
      stage1({ session: "old-host", requested: "wasm-frame" }),
    ];
    const f = floorAt(out, "1");
    expect(f.engaged.n).toBe(0);
    // Attempts that never engaged on the engine are in the attempts row, not the floor.
    expect(f.attempts.n).toBe(2);
  });

  it("keeps a session with an override page life out, as the cohorts do", () => {
    const f = floorAt(
      [
        stage1({ session: "a" }),
        stage1({
          session: "a",
          selectedBy: "setting",
          firstSeen: "2026-12-01 13:00:00",
        }),
      ],
      "1",
    );
    expect(f.engaged.n).toBe(0);
    expect(f.engaged.overridden).toBe(1);
  });

  it("charges a fault and a same-session crash loop to the stage's rows", () => {
    const lives = [
      stage1({ session: "a", ...fault }),
      stage1({ session: "b", engaged: false, ...fault }),
      stage1({ session: "c" }),
      stage1({
        session: "c",
        selectedBy: "safety-device",
        requested: "ts",
        reasons: ["unclean-exit"],
        engaged: false,
        firstSeen: "2026-12-01 12:05:00",
      }),
    ];
    const f = floorAt(lives, "1");
    expect(f.engaged.n).toBe(2);
    expect(f.engaged.faults).toBe(2);
    expect(f.attempts.n).toBe(3);
    expect(f.attempts.faults).toBe(3);
  });

  it("reaches the floor at exactly its count", () => {
    const lives = Array.from({ length: 30 }, (_, i) =>
      stage1({ session: `s${i}` }),
    );
    expect(floorAt(lives, "1").reached).toBe(true);
    expect(floorAt(lives.slice(1), "1").reached).toBe(false);
  });

  it("prints a row per stage, the builds and the caveat, inside the report", () => {
    const lives = [stage1({ session: "a" })];
    const md = renderFloorsMarkdown(summarizeFloors(lives)).join("\n");
    expect(md).toContain("| `1` | 30 | 1 | no | 0 | 1 | 0 | 0 |");
    expect(md).toContain("| `2` | 100 | 0 | no | 0 | 0 | 0 | 0 |");
    expect(md).toContain("Stage `1` engaged sessions by build");
    expect(md).toContain("never a reliability figure");
    const report = renderReliabilityMarkdown(summarizeReliability(lives), {
      windowLabel: "last 7 days",
      until: "2026-12-02 00:00",
      hosts: ["wasm"],
      builds: "all",
      arms: "all",
      truncated: false,
      crashesTruncated: false,
      cohorts: run(lives),
      floors: summarizeFloors(lives),
      eligibleShas: [],
      tailShas: [],
    });
    expect(report).toContain("### Stage floors");
  });
});

describe("page-life times (#1249)", () => {
  it("reads a time without an offset as UTC, whatever the machine's zone", () => {
    const zone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 02:30 does not exist in New York on 2026-03-08; read locally it lands at 03:30 and sorts after 03:10.
      expect(when(life({ firstSeen: "2026-03-08 02:30:00" }))).toBeLessThan(
        when(life({ firstSeen: "2026-03-08 03:10:00" })),
      );
      const c = run([
        life({
          session: "a",
          assignedArm: "ts",
          requested: "ts",
          engaged: false,
          firstSeen: "2026-03-08 03:10:00",
        }),
        life({ session: "a", firstSeen: "2026-03-08 02:30:00" }),
      ]);
      // The session's first page life is the WASM one, so its arm is WASM.
      expect(c.changed.sessions).toBe(1);
      expect(c.eligible.n).toBe(1);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
    expect(when(life({ firstSeen: "2026-03-08 02:30:00" }))).toBe(
      Date.UTC(2026, 2, 8, 2, 30),
    );
    expect(when(life({ firstSeen: "2026-03-08T02:30:00-05:00" }))).toBe(
      Date.UTC(2026, 2, 8, 7, 30),
    );
    expect(when(life({ firstSeen: "" }))).toBe(Number.POSITIVE_INFINITY);
  });
});
