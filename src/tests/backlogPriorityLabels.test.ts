import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  citedButNotOpen,
  ghCli,
  parseBacklogPriorities,
  planLabelChanges,
  run,
  type Gh,
} from "../../scripts/backlog-priority-labels.mjs";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile, default: { execFile } }));

/**
 * The P1/P2/P3 issue labels mirror the backlog's Priority column
 * (scripts/backlog-priority-labels.mjs, run by backlog-priority-labels.yml when
 * a push to main changes the backlog, and weekly). These pin the parse, the
 * relabel plan and the write loop, and check that the real backlog parses
 * cleanly so a bad Priority cell fails here instead of in the workflow.
 */

const HEAD = [
  "| Date | Story | GH | Epic | Type | Priority | Severity | Owner | Status | Notes |",
  "| ---- | ----- | -- | ---- | ---- | -------- | -------- | ----- | ------ | ----- |",
];
const row = (gh: string, priority: string, notes = "n") =>
  `| 2026-10-15 | s | ${gh} | e | task | ${priority} | low | — | open | ${notes} |`;

describe("parseBacklogPriorities", () => {
  it("maps each row-cited issue to its priority and skips finished rows", () => {
    const md = [
      ...HEAD,
      row("#10", "P1"),
      row("—", "P2"),
      row("#11", "P3", "a \\| b"),
    ].join("\n");
    const { priorities, errors } = parseBacklogPriorities(md);
    expect(errors).toEqual([]);
    expect([...priorities]).toEqual([
      [10, "P1"],
      [11, "P3"],
    ]);
  });

  it("reads a CRLF file the same way", () => {
    const md = [...HEAD, row("#10", "P2")].join("\r\n");
    expect([...parseBacklogPriorities(md).priorities]).toEqual([[10, "P2"]]);
  });

  it("reports a priority it cannot read instead of guessing", () => {
    const { priorities, errors } = parseBacklogPriorities(
      [...HEAD, row("#12", "high")].join("\n"),
    );
    expect(priorities.size).toBe(0);
    expect(errors).toEqual(['#12: priority "high" is not P1, P2 or P3']);
  });

  it("leaves an issue alone when its rows disagree, whatever the row order", () => {
    const md = [
      ...HEAD,
      row("#15", "P1"),
      row("#15", "P3"),
      row("#15", "P1"),
      row("#16", "P2"),
    ].join("\n");
    const { priorities, errors } = parseBacklogPriorities(md);
    expect([...priorities]).toEqual([[16, "P2"]]);
    expect(errors).toEqual(["#15: rows disagree on its priority"]);
  });

  it("holds an issue back when one of its rows has an unreadable priority", () => {
    const md = [...HEAD, row("#50", "P1"), row("#50", "p3")].join("\n");
    const { priorities, errors } = parseBacklogPriorities(md);
    expect(priorities.size).toBe(0);
    expect(errors).toEqual(['#50: priority "p3" is not P1, P2 or P3']);
  });

  it("stops at the end of the curated table", () => {
    const md = [...HEAD, row("#13", "P2"), "", row("#14", "P1")].join("\n");
    expect([...parseBacklogPriorities(md).priorities.keys()]).toEqual([13]);
  });

  it("fails loudly when the table header is missing", () => {
    expect(parseBacklogPriorities("# no table").errors).toEqual([
      "curated-table header not found",
    ]);
  });

  it("reads the real backlog with no errors", () => {
    const backlog = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../_bmad-output/implementation-artifacts/backlog.md",
    );
    const { priorities, errors } = parseBacklogPriorities(
      readFileSync(backlog, "utf8"),
    );
    expect(errors).toEqual([]);
    expect(priorities.size).toBeGreaterThan(0);
  });
});

describe("planLabelChanges", () => {
  const priorities = new Map([
    [1, "P1"],
    [2, "P2"],
    [3, "P3"],
    [4, "P2"],
  ] as const);

  it("adds the missing label, swaps a wrong one, drops needs-triage and keeps other labels", () => {
    const open = new Map<number, string[]>([
      [1, ["bug", "needs-triage"]],
      [2, ["P3", "ui"]],
      [3, ["P3", "P1"]],
    ]);
    expect(planLabelChanges(priorities, open)).toEqual([
      { issue: 1, add: "P1", remove: ["needs-triage"] },
      { issue: 2, add: "P2", remove: ["P3"] },
      { issue: 3, add: null, remove: ["P1"] },
    ]);
  });

  it("leaves closed issues and issues no row cites alone, and lists the closed ones", () => {
    const open = new Map<number, string[]>([
      [2, ["P2"]],
      [99, ["P1", "needs-triage"]],
    ]);
    expect(planLabelChanges(priorities, open)).toEqual([]);
    expect(citedButNotOpen(priorities, open)).toEqual([1, 3, 4]);
  });
});

/** A fake `gh`: labels that exist, open issues with their labels, and a log
 *  of every `gh api` write as "#N POST label" or "#N DELETE label". `failOn`
 *  makes writes to that issue fail; `limitOn` makes them fail as rate limited
 *  (`limitTimes` times); `goneOn` answers its DELETEs with GitHub's "label
 *  does not exist" 404; `issueListError` and `labelError` fail the reads. */
function fakeGh(
  issues: Record<number, string[]>,
  opts: {
    missing?: string;
    labelError?: boolean;
    failOn?: number;
    limitOn?: number;
    limitTimes?: number;
    issueListError?: boolean;
    goneOn?: number;
  } = {},
) {
  const writes: string[] = [];
  let limits = opts.limitTimes ?? Infinity;
  const gh: Gh = async (args) => {
    const [noun, verb] = args;
    if (noun === "label" && verb === "list") {
      if (opts.labelError) throw new Error("gh label list: HTTP 403");
      return JSON.stringify(
        ["P1", "P2", "P3", "needs-triage"]
          .filter((l) => l !== opts.missing)
          .map((name) => ({ name })),
      );
    }
    if (noun === "issue" && verb === "list") {
      if (opts.issueListError) throw new Error("gh issue list: HTTP 502");
      return JSON.stringify(
        Object.entries(issues).map(([n, labels]) => ({
          number: Number(n),
          labels: labels.map((name) => ({ name })),
        })),
      );
    }
    if (noun === "api") {
      const method = args[2];
      const path = args[3];
      const n = Number(/issues\/(\d+)\//.exec(path)?.[1]);
      const label =
        method === "POST"
          ? args[args.length - 1].replace("labels[]=", "")
          : decodeURIComponent(path.split("/").pop()!);
      writes.push(`#${n} ${method} ${label}`);
      if (n === opts.limitOn && limits-- > 0)
        throw Object.assign(new Error("secondary rate limit (HTTP 403)"), {
          rateLimited: true,
        });
      if (n === opts.failOn) throw new Error("gh api: Bad Gateway (HTTP 502)");
      if (method === "DELETE" && n === opts.goneOn)
        throw new Error("gh api: Label does not exist (HTTP 404)");
      return "";
    }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, writes };
}

describe("run", () => {
  const markdown = [
    ...HEAD,
    row("#1", "P1"),
    row("#2", "P2"),
    row("#3", "P3"),
  ].join("\n");
  const quiet = () => {};
  const noWait = async () => {};

  it("adds before it removes, so a failure never leaves an issue with no P label", async () => {
    const fake = fakeGh({ 1: ["P3"] });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(fake.writes).toEqual(["#1 POST P1", "#1 DELETE P3"]);
  });

  it("keeps going past a failed issue and reports it", async () => {
    const fake = fakeGh({ 1: [], 2: [], 3: [] }, { failOn: 2 });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([2]);
    expect(fake.writes).toEqual(["#1 POST P1", "#2 POST P2", "#3 POST P3"]);
  });

  it("refuses to write when a P label is missing from the repository", async () => {
    const fake = fakeGh({ 1: [] }, { missing: "P2" });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "label P2 missing from o/r; run the Sync labels workflow first",
    ]);
    expect(fake.writes).toEqual([]);
  });

  it("reports a failed label lookup as itself, not as a missing label", async () => {
    const fake = fakeGh({ 1: [] }, { labelError: true });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "could not list labels: gh label list: HTTP 403",
    ]);
    expect(fake.writes).toEqual([]);
  });

  it("treats a backlog with no cited rows as nothing to sync", async () => {
    const md = [...HEAD, row("—", "P2")].join("\n");
    const fake = fakeGh({ 1: [] });
    const result = await run({
      markdown: md,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(fake.writes).toEqual([]);
  });

  it("still syncs the readable rows when one row is unreadable", async () => {
    const md = [...HEAD, row("#1", "P1"), row("#2", "p2")].join("\n");
    const fake = fakeGh({ 1: [], 2: [] });
    const result = await run({
      markdown: md,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(fake.writes).toEqual(["#1 POST P1"]);
  });

  it("stops writing when a retry is rate limited too, and reports the skipped issues", async () => {
    const fake = fakeGh({ 1: [], 2: [], 3: [] }, { limitOn: 2 });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([2, 3]);
    // One wait and retry, then it stops.
    expect(fake.writes).toEqual(["#1 POST P1", "#2 POST P2", "#2 POST P2"]);
  });

  it("treats removing a label that is already gone as done", async () => {
    const fake = fakeGh({ 1: ["P1", "needs-triage"] }, { goneOn: 1 });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(fake.writes).toEqual(["#1 DELETE needs-triage"]);
  });

  it("fails a removal whose 404 is not a missing label", async () => {
    const gh: Gh = async (args) => {
      if (args[0] === "label")
        return JSON.stringify(["P1", "P2", "P3"].map((name) => ({ name })));
      if (args[0] === "issue")
        return JSON.stringify([
          { number: 1, labels: [{ name: "P1" }, { name: "P2" }] },
        ]);
      throw new Error("gh api: Not Found (HTTP 404)");
    };
    const result = await run({
      markdown,
      repo: "o/r",
      gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.failures).toEqual([1]);
  });

  it("waits out one rate limit and retries the write", async () => {
    const fake = fakeGh({ 1: [], 2: [], 3: [] }, { limitOn: 2, limitTimes: 1 });
    const waits: number[] = [];
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: async (ms) => void waits.push(ms),
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([60_000]);
    expect(fake.writes).toEqual([
      "#1 POST P1",
      "#2 POST P2",
      "#2 POST P2",
      "#3 POST P3",
    ]);
  });

  it("reports a failed issue listing and writes nothing", async () => {
    const fake = fakeGh({ 1: [] }, { issueListError: true });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "could not list open issues: gh issue list: HTTP 502",
    ]);
    expect(fake.writes).toEqual([]);
  });

  it("removes every stale label, one request each", async () => {
    const fake = fakeGh({ 2: ["P1", "P3", "needs-triage", "bug"] });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(fake.writes).toEqual([
      "#2 POST P2",
      "#2 DELETE P1",
      "#2 DELETE P3",
      "#2 DELETE needs-triage",
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const fake = fakeGh({ 1: ["P3"] });
    const result = await run({
      markdown,
      repo: "o/r",
      gh: fake.gh,
      dryRun: true,
      pauseMs: 0,
      sleep: noWait,
      log: quiet,
    });
    expect(result.plan).toHaveLength(1);
    expect(fake.writes).toEqual([]);
  });
});

describe("ghCli", () => {
  type Callback = (err: Error | null, stdout: string, stderr: string) => void;
  const answer = (err: Error | null, stdout: string, stderr = "") =>
    execFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: Callback) =>
        cb(err, stdout, stderr),
    );

  it("runs gh with the given arguments and returns its stdout", async () => {
    answer(null, "[]");
    await expect(ghCli()(["label", "list"])).resolves.toBe("[]");
    expect(execFile.mock.lastCall?.slice(0, 2)).toEqual([
      "gh",
      ["label", "list"],
    ]);
  });

  it("rejects with gh's stderr and flags a rate limit", async () => {
    answer(
      new Error("exit 1"),
      "",
      "HTTP 403: You have exceeded a secondary rate limit",
    );
    await expect(
      ghCli()(["api", "--method", "POST", "repos/o/r/issues/7/labels"]),
    ).rejects.toMatchObject({
      message:
        "gh api POST repos/o/r/issues/7/labels: HTTP 403: You have exceeded a secondary rate limit",
      rateLimited: true,
    });
    answer(new Error("exit 1"), "", "HTTP 502: Bad Gateway");
    await expect(
      ghCli()(["api", "--method", "POST", "repos/o/r/issues/7/labels"]),
    ).rejects.toMatchObject({
      rateLimited: false,
    });
  });

  it("names a missing gh and a timeout plainly", async () => {
    answer(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }), "");
    await expect(ghCli()(["label", "list"])).rejects.toThrow(
      "the gh CLI is not on PATH",
    );
    answer(Object.assign(new Error("killed"), { killed: true }), "");
    await expect(
      ghCli()(["api", "--method", "POST", "repos/o/r/issues/7/labels"]),
    ).rejects.toThrow("timed out after a minute");
  });

  it("flags the GraphQL wording for mutations sent too fast", async () => {
    answer(new Error("exit 1"), "", "GraphQL: was submitted too quickly");
    await expect(
      ghCli()(["api", "--method", "POST", "repos/o/r/issues/7/labels"]),
    ).rejects.toMatchObject({
      rateLimited: true,
    });
  });
});
