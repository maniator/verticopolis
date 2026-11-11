import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FULL_LANE, pathKind, prLane } from "./prLane";

describe("pathKind", () => {
  it.each([
    ["src/ui/templates/updatePrompt.ts", "shared"],
    ["e2e/visual.spec.ts", "shared"],
    ["scripts/pr-lane.ts", "shared"],
    ["package.json", "shared"],
    ["package-lock.json", "shared"],
    ["vite.config.ts", "shared"],
    ["conformance/expected.json", "shared"],
    ["docs/screenshots/milestones/one-star.png", "shared"],
    [".github/workflows/test.yml", "shared"],
    [".github/actions/engine-wasm/action.yml", "shared"],
    ["engine-rs/Cargo.toml", "shared"],
    ["engine-rs/Cargo.lock", "shared"],
    ["engine-rs/consumer/Cargo.toml", "shared"],
    ["engine-rs/consumer/Cargo.lock", "shared"],
    ["engine-rs/src/wasm.rs", "shared"],
    ["engine-rs/src/wasm/exports_port.rs", "shared"],
    ["engine-rs/src/wasm_port_panels.rs", "shared"],
    ["engine-rs/src/frame.rs", "shared"],
    ["engine-rs/src/frame_tests.rs", "rust"],
    ["engine-rs/src/events_bomb.rs", "rust"],
    ["engine-rs/tests/independence.rs", "rust"],
    ["engine-rs/consumer/src/main.rs", "rust"],
    ["engine-rs/CHANGELOG.md", "rust"],
    ["docs/performance/hot-path-review.md", "prose"],
    ["_bmad-output/implementation-artifacts/backlog.md", "prose"],
    [".changes/claude-project-thread-aan2dj.md", "prose"],
    ["CHANGELOG.md", "prose"],
    ["README.md", "prose"],
    [".github/workflows/engine-rs.yml", "meta"],
    [".github/ISSUE_TEMPLATE/bug.yml", "meta"],
    [".github/dependabot.yml", "meta"],
    [".pr_agent.toml", "meta"],
    ["docs/ci/pr-agent.md", "meta"],
    [".nvmrc", "shared"],
  ])("%s is %s", (path, kind) => {
    expect(pathKind(path)).toBe(kind);
  });
});

describe("prLane", () => {
  it("runs everything for a UI change", () => {
    expect(prLane(["src/ui/templates/updatePrompt.ts", "src/styles.css", "CHANGELOG.md"])).toEqual(FULL_LANE);
  });

  it("takes the Rust lane for engine sources, tests and notes only", () => {
    expect(
      prLane(["engine-rs/src/events_bomb.rs", "engine-rs/src/events_bomb_tests.rs", ".changes/fix-bomb.md", "docs/notes.md"]),
    ).toEqual({ code: true, tests: true, lane: "rust" });
  });

  it("runs everything when a Rust change also touches a Cargo file or the binding", () => {
    expect(prLane(["engine-rs/src/events_bomb.rs", "engine-rs/Cargo.lock"])).toEqual(FULL_LANE);
    expect(prLane(["engine-rs/src/events_bomb.rs", "engine-rs/src/wasm/exports_port.rs"])).toEqual(FULL_LANE);
  });

  it("takes the prose lane for docs and change notes", () => {
    expect(prLane(["docs/performance/hot-path-review.md", "_bmad-output/implementation-artifacts/backlog.md"])).toEqual({
      code: false,
      tests: true,
      lane: "prose",
    });
    expect(prLane([".changes/some-branch.md"])).toEqual({ code: false, tests: true, lane: "prose" });
  });

  it("runs nothing for CI metadata alone", () => {
    expect(prLane([".github/workflows/pr-agent.yml", "docs/ci/pr-agent.md"])).toEqual({
      code: false,
      tests: false,
      lane: "prose",
    });
  });

  it("runs everything when a file moves out of a shared path", () => {
    // The workflow passes a rename's old path as its own line.
    expect(prLane(["docs/old-module.md", "src/game/oldModule.ts"])).toEqual(FULL_LANE);
  });

  it("runs everything for an empty list", () => {
    expect(prLane([])).toEqual(FULL_LANE);
    expect(prLane([""])).toEqual(FULL_LANE);
  });
});

// The prose lane runs the unit project only, so an integration test that
// reads a prose path would stop running on the PRs that change it. Comment
// lines may cite a prose file; code lines may not name one.
describe("the prose lane's unit-only promise", () => {
  const prosePath = /["'`](docs\/|_bmad-output\/|\.changes\/|(CHANGELOG|README|CONTRIBUTING|AGENTS|CLAUDE)\.md)/;
  const commentLine = /^\s*(\*|\/\/|\/\*)/;

  it("no integration test names a prose path", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const offenders = readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".integration.test.ts"))
      .filter((file) =>
        readFileSync(join(root, file), "utf8")
          .split("\n")
          .some((line) => !commentLine.test(line) && prosePath.test(line)),
      );
    expect(offenders).toEqual([]);
  });
});
