import { describe, expect, it } from "vitest";
import type { FrameDayStart } from "./frameDays";
import { PORT_EDIT_CASES } from "./portEditCases";
import { answerNumber, firstPortEditDifference, portEditProblems, readPortEdits, STATUS, type AnswerValue, type LineKind, type PortEditLine } from "./portEditLines";

/** A line whose kind follows from its step: "start", "play ...", and the
 *  swap, undo and read steps the tests name, and a command otherwise. */
function kindOf(step: string): LineKind {
  if (step === "start") return "start";
  if (step.startsWith("play")) return "play";
  if (step.startsWith("restore") || step.startsWith("load")) return "swap";
  if (step.startsWith("undo") || step.startsWith("redo")) return "history";
  if (step.startsWith("open") || step.startsWith("close")) return "undo step";
  if (step.startsWith("read")) return "read";
  return "command";
}
const line = (step: string, answer: AnswerValue, state = "s", count = 0, crowd = "c"): PortEditLine => ({ step, kind: kindOf(step), answer, minute: 0, state, crowd, events: "e", count });
const { done: DONE, refused: REFUSED, nothingToStep: NOTHING_TO_STEP } = STATUS;
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
    const want = [line("start", null), line("build", { status: DONE, delta: -500 }), line("play", { hour: 8 })];
    expect(firstPortEditDifference([line("start", null), line("build", { delta: -500, status: DONE }), line("play", { hour: 8 })], want)).toBeNull();
    expect(firstPortEditDifference([line("start", null), line("build", { status: REFUSED, delta: 0 }, "x"), line("play", { hour: 8 }, "y")], want)).toBe(
      'line 1 (build): answer {"delta":0,"status":0} != pinned {"delta":-500,"status":1}, state "x" != pinned "s"',
    );
    expect(firstPortEditDifference([line("start", null), line("sell", { status: DONE, delta: -500 }, "s", 1)], want)).toBe('line 1 (build): step "sell" != pinned "build", count 1 != pinned 0');
    expect(firstPortEditDifference([line("start", null), { ...line("build", { status: DONE, delta: -500 }), kind: "swap" }, line("play", { hour: 8 })], want)).toBe(
      'line 1 (build): kind "swap" != pinned "command"',
    );
  });

  it("names a missing or extra line and a case the golden lacks", () => {
    const want = [line("start", null), line("play", "end")];
    expect(firstPortEditDifference([line("start", null)], want)).toBe("line 1: missing (ran 1, pinned 2)");
    expect(firstPortEditDifference([...want, line("play", "end")], want)).toBe("line 2: extra (ran 3, pinned 2)");
    expect(firstPortEditDifference(want, undefined)).toBe("the golden has no entry for this case");
  });

  it("skips only the fields of the lines an allowance names", () => {
    const want = [line("start", null), line("undo", { status: DONE }, "s", 0, "c1"), line("play 60 minutes", { hour: 9 }, "s2", 0, "c2")];
    const got = [line("start", null), line("undo", { status: DONE }, "s", 0, "x1"), line("play 60 minutes", { hour: 9 }, "s2", 0, "x2")];
    expect(firstPortEditDifference(got, want, (i, field) => field === "crowd" && i >= 1)).toBeNull();
    expect(firstPortEditDifference(got, want, (i, field) => field === "crowd" && i === 1)).toBe('line 2 (play 60 minutes): crowd "x2" != pinned "c2"');
    expect(firstPortEditDifference(got, want, (i, field) => field === "state" && i >= 1)).toBe('line 1 (undo): crowd "x1" != pinned "c1"');
  });

  it("calls a case thin when a refusal moved something, a charge moved no state, or it plays no hour", () => {
    const start = line("start", null, "s0");
    const played = line("play 60 minutes", { hour: 8 }, "s9");
    expect(portEditProblems(FOUND, [start, line("build", { status: DONE, delta: -500 }, "s1", 1), line("refused", { status: REFUSED, delta: 0, reason: "no" }, "s1"), played])).toEqual([]);
    // A done command that moved no money may move nothing (a raise at the top step).
    expect(portEditProblems(FOUND, [start, line("raise", { status: DONE, delta: 0, rent: 15000 }, "s0"), played])).toEqual([]);
    expect(portEditProblems(FOUND, [start, line("refused", { status: REFUSED, delta: 0 }, "s1"), played])).toEqual(["line 1 (refused): refused, but it moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("refused", { status: REFUSED, delta: 0 }, "s0", 0, "moved"), played])).toEqual(["line 1 (refused): refused, but it moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("refused", { status: REFUSED, delta: 0 }, "s0", 1), played])).toEqual(["line 1 (refused): refused, but it moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("undo", { status: NOTHING_TO_STEP, notice: "Nothing to undo." }, "s1"), played])).toEqual([
      "line 1 (undo): nothing to step, but it moved the tower or drained an event",
    ]);
    expect(portEditProblems(FOUND, [start, line("sell", { status: DONE, delta: 20000 }, "s0"), played])).toEqual(["line 1 (sell): moved 20000 in money, but not the state"]);
    expect(portEditProblems(FOUND, [start, line("play 60 minutes", "end", "s1")])).toEqual(["plays no hour"]);
  });

  it("holds each other kind of line to what it may move", () => {
    const start = line("start", null, "s0");
    const played = line("play 60 minutes", { hour: 8 }, "s9");
    expect(portEditProblems(FOUND, [start, line("refused", { status: REFUSED, delta: -500 }, "s0"), played])).toEqual(["line 1 (refused): refused, but it moved -500 in money"]);
    expect(portEditProblems(FOUND, [start, line("build", { delta: -500 }, "s1"), played])).toEqual(["line 1 (build): a command line with no status"]);
    expect(portEditProblems(FOUND, [start, line("read the name", "Tower", "s1"), played])).toEqual(["line 1 (read the name): a read moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("open an undo step: Sell", null, "s0", 1), played])).toEqual(["line 1 (open an undo step: Sell): an undo step moved the tower or drained an event"]);
    expect(portEditProblems(FOUND, [start, line("undo the sale", { status: DONE, notice: "Undid: Sell" }, "s0"), played])).toEqual([
      "line 1 (undo the sale): took an undo step, but the state did not move",
    ]);
    // A tooling write, a tick and a swap that landed may move anything.
    const tooling: PortEditLine = { ...line("set money", null, "s1", 0, "c1"), kind: "tooling" };
    const tick: PortEditLine = { ...line("tick 1 minute", null, "s2", 1, "c2"), kind: "tick" };
    expect(portEditProblems(FOUND, [start, tooling, tick, line("restore a save", { status: DONE }, "s3", 2, "c3"), played])).toEqual([]);
    expect(portEditProblems(FOUND, [start, line("undo a step", { notice: "Undid: Sell" }, "s1"), played])).toEqual(["line 1 (undo a step): a history line with no status"]);
    expect(portEditProblems(FOUND, [start, line("undo with nothing left", { status: NOTHING_TO_STEP, notice: "Nothing to undo." }, "s0", 1), played])).toEqual([
      "line 1 (undo with nothing left): nothing to step, but it moved the tower or drained an event",
    ]);
  });

  it("holds each line to a status its kind can answer, and a kind the golden names", () => {
    const start = line("start", null, "s0");
    const played = line("play 60 minutes", { hour: 8 }, "s9");
    expect(portEditProblems(FOUND, [start, line("restore a save", { status: REFUSED }, "s0"), played])).toEqual(["line 1 (restore a save): a swap that did not land"]);
    expect(portEditProblems(FOUND, [start, line("load a save", null, "s1"), played])).toEqual(["line 1 (load a save): a swap line with no status"]);
    expect(portEditProblems(FOUND, [start, line("build", { status: NOTHING_TO_STEP, delta: 0 }, "s0"), played])).toEqual([
      "line 1 (build): a command line with nothing to step, which only an undo or redo answers",
    ]);
    expect(portEditProblems(FOUND, [start, line("build", { status: 7, delta: 0 }, "s0"), played])).toEqual(["line 1 (build): a command line with the status 7, which the contract does not name"]);
    expect(portEditProblems(FOUND, [start, line("build", { status: DONE, delta: "NaN" }, "s0"), played])).toEqual(["line 1 (build): moved NaN in money, which is no number"]);
    const misnamed = { ...line("build", { status: DONE, delta: -500 }, "s1"), kind: "comand" } as unknown as PortEditLine;
    expect(portEditProblems(FOUND, [start, misnamed, played])).toEqual(['line 1 (build): no line kind is named "comand"']);
    expect(portEditProblems(FOUND, [line("build", { status: DONE, delta: -500 }, "s1"), played])).toEqual(["line 0 (build): the first line is no start"]);
    expect(portEditProblems(FOUND, [start, line("start", null, "s0"), played])).toEqual(["line 1 (start): a start after the first line"]);
  });

  it("calls a fixture case thin when its crowd never moves during play", () => {
    const start = line("start", null, "s0", 0, "c0");
    // A founded tower starts empty, so a still crowd is no problem there.
    expect(portEditProblems(FOUND, [start, line("play 60 minutes", { hour: 8 }, "s1", 0, "c0")])).toEqual([]);
    expect(portEditProblems(FIXTURE, [start, line("play 60 minutes", { hour: 8 }, "s1", 0, "c0")])).toEqual(["the crowd never moves during play"]);
    // A command that moves the crowd is not play.
    expect(portEditProblems(FIXTURE, [start, line("sell", { status: DONE, delta: 20000 }, "s1", 0, "c1"), line("play 60 minutes", { hour: 8 }, "s2", 0, "c1")])).toEqual([
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
      expect([lines[0].step, lines[0].kind], c.id).toEqual(["start", "start"]);
      expect(portEditProblems(c.start, lines), c.id).toEqual([]);
      // #1802 changes the generation an undo answers, so no line pins one.
      for (const l of lines) if (typeof l.answer === "object" && l.answer !== null) expect(Object.keys(l.answer), `${c.id}: ${l.step}`).not.toContain("generation");
    }
  });

  it("pin the game's undo and redo with the notice the game shows, and an earlier save's restore", () => {
    const fourStar = readPortEdits().cases["four-star tower edits"];
    const answerOf = (step: string) => fourStar.find((l) => l.step === step)?.answer;
    expect(answerOf("undo the bulldoze")).toEqual({ status: DONE, notice: "Undid: Bulldoze" });
    expect(answerOf("redo the bulldoze")).toEqual({ status: DONE, notice: "Redid: Bulldoze" });
    expect(answerOf("undo the sale")).toEqual({ status: DONE, notice: "Undid: Sell" });
    expect(answerOf("undo with nothing left")).toEqual({ status: NOTHING_TO_STEP, notice: "Nothing to undo." });
    expect(answerOf("redo the bulldoze again")).toEqual({ status: DONE, notice: "Redid: Bulldoze" });
    expect(answerOf("close the refused bulldoze's undo step")).toEqual({ kept: false });
    expect(answerOf("restore the save from before the sale")).toEqual({ status: DONE });
    expect(answerOf("the camera after the restore")).toEqual({ tile: 200, floor: 20, zoom: 1 });
    expect(answerOf("undo after the restore")).toEqual({ status: NOTHING_TO_STEP, notice: "Nothing to undo." });
  });
});
