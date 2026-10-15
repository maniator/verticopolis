import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  citedButNotOpen,
  githubClient,
  parseBacklogPriorities,
  planLabelChanges,
  retryWaitSeconds,
  run,
  type Request,
} from "../../scripts/backlog-priority-labels.mjs";

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

/** An Error shaped like the ones githubClient throws. */
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

/** A fake GitHub: labels that exist, open issues with their labels, and a log
 *  of every write. `failOn` makes one path throw; `labelStatus` is the error
 *  a label lookup throws. */
function fakeGitHub(
  issues: Record<number, string[]>,
  opts: { missing?: string; labelStatus?: number; failOn?: string } = {},
) {
  const writes: string[] = [];
  const request: Request = async (method, path, body) => {
    if (opts.failOn && path.includes(opts.failOn) && method !== "GET")
      throw httpError(502);
    if (method === "GET" && path.includes("/labels/")) {
      if (opts.missing && path.endsWith(`/${opts.missing}`))
        throw httpError(opts.labelStatus ?? 404);
      return {};
    }
    if (method === "GET") {
      return Object.entries(issues).map(([n, labels]) => ({
        number: Number(n),
        labels: labels.map((name) => ({ name })),
      }));
    }
    writes.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
    return null;
  };
  return { request, writes };
}

describe("run", () => {
  const markdown = [
    ...HEAD,
    row("#1", "P1"),
    row("#2", "P2"),
    row("#3", "P3"),
  ].join("\n");
  const quiet = () => {};

  it("adds before it removes, so a failure never leaves an issue with no P label", async () => {
    const gh = fakeGitHub({ 1: ["P3"] });
    const result = await run({
      markdown,
      repo: "o/r",
      request: gh.request,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(gh.writes).toEqual([
      'POST /repos/o/r/issues/1/labels {"labels":["P1"]}',
      "DELETE /repos/o/r/issues/1/labels/P3",
    ]);
  });

  it("keeps going past a failed issue and reports it", async () => {
    const gh = fakeGitHub({ 1: [], 2: [], 3: [] }, { failOn: "/issues/2/" });
    const result = await run({
      markdown,
      repo: "o/r",
      request: gh.request,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([2]);
    expect(gh.writes.map((w) => w.split(" ")[1])).toEqual([
      "/repos/o/r/issues/1/labels",
      "/repos/o/r/issues/3/labels",
    ]);
  });

  it("refuses to write when a P label is missing from the repository", async () => {
    const gh = fakeGitHub({ 1: [] }, { missing: "P2" });
    const result = await run({
      markdown,
      repo: "o/r",
      request: gh.request,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "label P2 does not exist in o/r; run the Sync labels workflow first",
    ]);
    expect(gh.writes).toEqual([]);
  });

  it("reports a failed label lookup as itself, not as a missing label", async () => {
    const gh = fakeGitHub({ 1: [] }, { missing: "P1", labelStatus: 403 });
    const result = await run({
      markdown,
      repo: "o/r",
      request: gh.request,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["could not check label P1: HTTP 403"]);
    expect(gh.writes).toEqual([]);
  });

  it("treats a backlog with no cited rows as nothing to sync", async () => {
    const md = [...HEAD, row("—", "P2")].join("\n");
    const gh = fakeGitHub({ 1: [] });
    const result = await run({
      markdown: md,
      repo: "o/r",
      request: gh.request,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(gh.writes).toEqual([]);
  });

  it("still syncs the readable rows when one row is unreadable", async () => {
    const md = [...HEAD, row("#1", "P1"), row("#2", "p2")].join("\n");
    const gh = fakeGitHub({ 1: [], 2: [] });
    const result = await run({
      markdown: md,
      repo: "o/r",
      request: gh.request,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(gh.writes).toEqual([
      'POST /repos/o/r/issues/1/labels {"labels":["P1"]}',
    ]);
  });

  it("stops writing once rate limited and reports the skipped issues", async () => {
    const writes: string[] = [];
    const request: Request = async (method, path) => {
      if (method === "GET" && path.includes("/labels/")) return {};
      if (method === "GET")
        return [1, 2, 3].map((n) => ({ number: n, labels: [] }));
      writes.push(path);
      if (path.includes("/issues/2/"))
        throw Object.assign(httpError(403), { rateLimited: true });
      return null;
    };
    const result = await run({
      markdown,
      repo: "o/r",
      request,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([2, 3]);
    expect(writes).toEqual([
      "/repos/o/r/issues/1/labels",
      "/repos/o/r/issues/2/labels",
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const gh = fakeGitHub({ 1: ["P3"] });
    const result = await run({
      markdown,
      repo: "o/r",
      request: gh.request,
      dryRun: true,
      pauseMs: 0,
      log: quiet,
    });
    expect(result.plan).toHaveLength(1);
    expect(gh.writes).toEqual([]);
  });
});

describe("githubClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, headers: Record<string, string> = {}) =>
    new Response(status === 204 ? null : "{}", { status, headers });

  it("waits out a rate limit once, then retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(reply(200));
    vi.stubGlobal("fetch", fetchMock);
    const slept: number[] = [];
    const request = githubClient("t", {
      sleep: async (ms) => void slept.push(ms),
    });
    await request("POST", "/x", { labels: ["P1"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([2000]);
  });

  it("waits a minute on a secondary limit that sends no retry header", async () => {
    const limited = new Response("You have exceeded a secondary rate limit", {
      status: 403,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(reply(200));
    vi.stubGlobal("fetch", fetchMock);
    const slept: number[] = [];
    await githubClient("t", { sleep: async (ms) => void slept.push(ms) })(
      "POST",
      "/x",
      {},
    );
    expect(slept).toEqual([60_000]);
  });

  it("waits a minute on a 429 that sends no timing header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(200));
    vi.stubGlobal("fetch", fetchMock);
    const slept: number[] = [];
    await githubClient("t", { sleep: async (ms) => void slept.push(ms) })(
      "POST",
      "/x",
      {},
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([60_000]);
  });

  it("gives up without waiting when the limit resets past a minute away", async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 1800);
    const limited = reply(403, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": reset,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(limited));
    const slept: number[] = [];
    const request = githubClient("t", {
      sleep: async (ms) => void slept.push(ms),
    });
    await expect(request("POST", "/x", {})).rejects.toMatchObject({
      status: 403,
      rateLimited: true,
    });
    expect(slept).toEqual([]);
  });

  it("throws the HTTP status, and treats a DELETE 404 as already done", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(reply(502))
        .mockResolvedValueOnce(reply(404)),
    );
    const request = githubClient("t", { sleep: async () => {} });
    await expect(request("GET", "/x")).rejects.toMatchObject({ status: 502 });
    await expect(request("DELETE", "/x")).resolves.toBeNull();
  });
});

describe("retryWaitSeconds", () => {
  const res = (h: Record<string, string>) =>
    new Response(null, { status: 403, headers: h });
  const now = Date.parse("2026-10-15T12:00:00Z");

  it("reads Retry-After as seconds or as an HTTP date", () => {
    expect(retryWaitSeconds(res({ "retry-after": "7" }), now)).toBe(7);
    expect(
      retryWaitSeconds(
        res({ "retry-after": "Thu, 15 Oct 2026 12:00:30 GMT" }),
        now,
      ),
    ).toBe(30);
  });

  it("reads a primary rate limit from its reset time", () => {
    const reset = String(now / 1000 + 45);
    expect(
      retryWaitSeconds(
        res({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset }),
        now,
      ),
    ).toBe(45);
  });

  it("returns null for a refusal that is not a rate limit", () => {
    expect(
      retryWaitSeconds(res({ "x-ratelimit-remaining": "12" }), now),
    ).toBeNull();
  });
});
