import { describe, expect, it } from "vitest";
import type { FrameDayStart } from "./frameDays";
import { PORT_EDIT_CASES } from "./portEditCases";
import { answerNumber, firstPortEditDifference, portEditProblems, readPortEdits, STATUS, type AnswerValue, type PortEditLine } from "./portEdits";

const line = (step: string, answer: AnswerValue, state = "s", count = 0, crowd = "c"): PortEditLine => ({ step, answer, minute: 0, state, crowd, events: "e", count });
const FOUND: FrameDayStart = { kind: "found", seed: 1, mode: "classic", calendar: "realWorld", unbridged: false };
const FIXTURE: FrameDayStart = { kind: "fixture", file: "towerone-star4.vctower" };

describe("the port-edit golden's answers and comparison", () => {
  it("writes a slot JSON cannot hold by its name, and -0 as 0", () => {
    expect(answerNumber(Number.NaN)).toBe("NaN");
    expect(answerNumber(Infinity)).toBe("Infinity");
    expect(answerNumber(-Infinity)).toBe("-Infinity");
    expect(Object.is(answerNumber(-0), 0)).toBe(true);
    expect(answerNumber(-44500)).toBe(-44500);
  });

  it("agrees on equal runs and names the first line and field that moved", () => {
    const want = [line("start", null), line("build", { status: 1, delta: -500 }), line("play", { hour: 8 })];
    expect(firstPortEditDifference([line("start", null), line("build", { delta: -500, status: 1 }), line("play", { hour: 8 })], want)).toBeNull();
    expect(firstPortEditDifference([line("start", null), line("build", { status: 0, delta: 0 }, "x"), line("play", { hour: 8 }, "y")], want)).toBe(
      'line 1 (build): answer {"delta":0,"status":0} != pinned {"delta":-500,"status":1}, state "x" != pinned "s"',
    );
    expect(firstPortEditDifference([line("start", null), line("sell", { status: 1, delta: -500 }, "s", 1)], want)).toBe('line 1 (build): step "sell" != pinned "build", count 1 != pinned 0');
  });

  it("names a missing or extra line and a case the golden lacks", () => {
    const want = [line("start", null), line("play", "end")];
    expect(firstPortEditDifference([line("start", null)], want)).toBe("line 1: missing (ran 1, pinned 2)");
    expect(firstPortEditDifference([...want, line("play", "end")], want)).toBe("line 2: extra (ran 3, pinned 2)");
    expect(firstPortEditDifference(want, undefined)).toBe("the golden has no entry for this case");
  });

  it("skips only the fields of the lines an allowance names", () => {
    const want = [line("start", null), line("undo", { status: 1 }, "s", 0, "c1"), line("play 60 minutes", { hour: 9 }, "s2", 0, "c2")];
    const got = [line("start", null), line("undo", { status: 1 }, "s", 0, "x1"), line("play 60 minutes", { hour: 9 }, "s2", 0, "x2")];
    expect(firstPortEditDifference(got, want, (i, field) => field === "crowd" && i >= 1)).toBeNull();
    expect(firstPortEditDifference(got, want, (i, field) => field === "crowd" && i === 1)).toBe('line 2 (play 60 minutes): crowd "x2" != pinned "c2"');
    expect(firstPortEditDifference(got, want, (i, field) => field === "state" && i >= 1)).toBe('line 1 (undo): crowd "x1" != pinned "c1"');
  });

  it("calls a case thin when a refusal moved something, a charge moved no state, or it plays no hour", () => {
    const start = line("start", null, "s0");
    const played = line("play 60 minutes", { hour: 8 }, "s9");
    expect(portEditProblems(FOUND, [start, line("build", { status: 1, delta: -500 }, "s1", 1), line("refused", { status: 0, delta: 0, reason: "no" }, "s1"), played])).toEqual([]);
    // A done command that moved no money may move nothing (a raise at the top step).
    expect(portEditProblems(FOUND, [start, line("raise", { status: 1, delta: 0, rent: 15000 }, "s0"), played])).toEqual([]);
    expect(portEditProblems(FOUND, [start, line("refused", { status: 0, delta: 0 }, "s1"), played])).toEqual(["line 1 (refused): refused, but it moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("refused", { status: 0, delta: 0 }, "s0", 0, "moved"), played])).toEqual(["line 1 (refused): refused, but it moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("refused", { status: 0, delta: 0 }, "s0", 1), played])).toEqual(["line 1 (refused): refused, but it moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("undo", { status: STATUS.nothingToStep, notice: "Nothing to undo." }, "s1"), played])).toEqual([
      "line 1 (undo): nothing to step, but it moved the tower or drained an event",
    ]);
    expect(portEditProblems(FOUND, [start, line("sell", { status: 1, delta: 20000 }, "s0"), played])).toEqual(["line 1 (sell): moved 20000 in money, but not the state"]);
    expect(portEditProblems(FOUND, [start, line("play 60 minutes", "end", "s1")])).toEqual(["plays no hour"]);
  });

  it("calls a fixture case thin when its crowd never moves during play", () => {
    const start = line("start", null, "s0", 0, "c0");
    // A founded tower starts empty, so a still crowd is no problem there.
    expect(portEditProblems(FOUND, [start, line("play 60 minutes", { hour: 8 }, "s1", 0, "c0")])).toEqual([]);
    expect(portEditProblems(FIXTURE, [start, line("play 60 minutes", { hour: 8 }, "s1", 0, "c0")])).toEqual(["the crowd never moves during play"]);
    // A command that moves the crowd is not play.
    expect(portEditProblems(FIXTURE, [start, line("sell", { status: 1, delta: 20000 }, "s1", 0, "c1"), line("play 60 minutes", { hour: 8 }, "s2", 0, "c1")])).toEqual([
      "the crowd never moves during play",
    ]);
    expect(portEditProblems(FIXTURE, [start, line("play 60 minutes", { hour: 8 }, "s1", 0, "c1")])).toEqual([]);
  });
});

describe("the port-edit cases", () => {
  it("have unique ids, and are the cases the committed golden pins, in order", () => {
    const ids = PORT_EDIT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(readPortEdits().cases)).toEqual(ids);
  });

  it("start every case, pin no undo generation, and leave nothing thin", () => {
    const golden = readPortEdits();
    for (const c of PORT_EDIT_CASES) {
      const lines = golden.cases[c.id];
      expect(lines[0].step, c.id).toBe("start");
      expect(portEditProblems(c.start, lines), c.id).toEqual([]);
      // #1802 changes the generation an undo answers, so no line pins one.
      for (const l of lines) if (typeof l.answer === "object" && l.answer !== null) expect(Object.keys(l.answer), `${c.id}: ${l.step}`).not.toContain("generation");
    }
  });

  it("pin the game's undo and redo with the notice the game shows, and an earlier save's restore", () => {
    const fourStar = readPortEdits().cases["four-star tower edits"];
    const answerOf = (step: string) => fourStar.find((l) => l.step === step)?.answer;
    expect(answerOf("undo the bulldoze")).toEqual({ status: STATUS.done, notice: "Undid: Bulldoze" });
    expect(answerOf("redo the bulldoze")).toEqual({ status: STATUS.done, notice: "Redid: Bulldoze" });
    expect(answerOf("undo the sale")).toEqual({ status: STATUS.done, notice: "Undid: Sell" });
    expect(answerOf("undo with nothing left")).toEqual({ status: STATUS.nothingToStep, notice: "Nothing to undo." });
    expect(answerOf("close the refused bulldoze's undo step")).toEqual({ kept: false });
    expect(answerOf("restore the save from before the sale")).toEqual({ status: STATUS.done });
    expect(answerOf("the camera after the restore")).toEqual({ tile: 200, floor: 20, zoom: 1 });
    expect(answerOf("undo after the restore")).toEqual({ status: STATUS.nothingToStep, notice: "Nothing to undo." });
  });
});
