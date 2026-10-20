/**
 * What the hot-path guard (`hotPathReview.guard.test.ts`) pins: the page's
 * sections, section 1's surfaces, the clauses the overrides cite, the auditor
 * prompt, and each override's facts and step anchors. Kept apart from the test
 * so both stay under the file-size ceiling.
 */

export const PAGE = "docs/performance/hot-path-review.md";

export const SECTIONS = [
  "## 1. When it applies",
  "## 2. Frequencies and sizes",
  "## 3. The checklist",
  "## 4. Measuring",
  "## 5. The PR complexity note",
  "## 6. Recording the review",
  "## 7. Resolving a finding",
  "## 8. Worked example: what the Rust port shipped",
  "## 9. How the review tools apply it",
];

/** Section 1's table: every surface and its paths. Changing the gate's scope must be deliberate. */
export const SURFACES: Record<string, string[]> = {
  "Rust engine and its build": [
    "engine-rs/src/",
    "engine-rs/Cargo.toml",
    "engine-rs/Cargo.lock",
    "scripts/wasm-build.ts",
    "scripts/build-engine-wasm.sh",
  ],
  "TypeScript engine": ["src/engine/"],
  "WASM binding": [
    "engine-rs/src/wasm.rs",
    "engine-rs/src/frame.rs",
    "src/dualrun/",
  ],
  "Hosts (main thread and worker)": ["src/wasmhost/"],
  "Saves (load per command, autosave on a timer)": ["src/storage/"],
  "Rendering, frame loop and UI": [
    "src/render/",
    "src/presentation/",
    "src/game/",
    "src/ui/",
  ],
  "Per-frame and periodic services": ["src/analytics*.ts", "src/audio/"],
  "App shell": [
    "src/main.ts",
    "src/*.ts",
    "src/game/",
    "src/render/",
    "src/ui/",
  ],
};

/** The code spans of section 1's not-hot-path list, in order. */
export const NOT_HOT = [
  "*.test.ts",
  "src/tests/",
  "e2e/",
  "engine-rs/tests/",
  "*_tests.rs",
  "engine-rs/src/",
  "#[cfg(test)]",
  "*.fixture.ts",
  "src/ui/testing/",
  "engine-rs/src/bin/",
];

/** Clauses the overrides and summaries lean on, by the heading they must sit under. */
export const PAGE_CLAUSES: Record<string, string[]> = {
  "## 1. When it applies": [
    "keeps its independent review's GO at 3fa30a8c for the code that review covered",
    "any other hot-path change pushed to it gets the checklist",
    "A file being in scope is not a finding",
    "Every other pull request, whenever it was opened, gets the checklist on its next review, over its whole diff.",
  ],
  "## 3. The checklist": [
    "Count the visits per occurrence of the tier",
    "never averaged over a longer period",
    "Per frame and per chunk: no walk over any collection that grows with the tower",
    "Per step: no walk over units, tiles, population or the route graph.",
    "Repeated passes in the same step, and per-room work that walks other tiles or runs a route search, are findings.",
    "under about 50,000 visits on the large tower",
    "stays under about 1,000 item visits on the large tower",
    "Anything else is a dropped cache, which section 7 makes always `patch`",
    "does not close it",
    "Bypassing means computing what the cache holds without reading it",
  ],
  "## 6. Recording the review": [
    "the record goes on it as a comment",
    "Whoever runs the review skill posts its record at step 4 of every round",
    "counts only when it covers the whole diff of the PR",
    "until every chunk has its table and every changed function its appendix line",
    "cannot give a GO or a CONDITIONAL GO on it",
    "A review that is still running is not complete, and auto-merge stays off until both hold",
  ],
  "## 7. Resolving a finding": [
    "A finding is never dismissed for being pre-existing",
    "the code is not reachable from an entry point",
    "is a finding whatever its count",
    "Two kinds are always `patch`",
    "code the PR adds, ports or rewrites that puts a whole-collection walk under any HP-2 multiplier",
    "a change that drops, removes or bypasses a cache, index or counter either engine has",
    "Any other change to a moved function makes it a rewrite.",
    "repository owner (maniator)",
    "does not prove the acceptance on its own",
    "`decision_needed` until the owner answers, in spec mode and no-spec mode alike",
  ],
};

/** Sentences of the Hot-Path Auditor prompt (section 9) the layer depends on. */
export const PROMPT = [
  "You are the Hot-Path Auditor.",
  "read it at the diff's head commit",
  "trace its callers across every hot-path surface in section 1",
  "list the TypeScript caches, indexes and counters for the same function and its callees",
  "Report pre-existing code too, marked pre-existing.",
  "Output the section 6 table with a row for every item",
  "add the section 6 appendix lines for its changed functions",
];

export const SKILL_ROOTS = [".claude/skills", ".agents/skills"];

export type Skill = {
  name: string;
  twin: string;
  stepDir: string;
  facts: Record<string, string[]>;
  onComplete: string[];
  activation: string[];
  anchors: Record<string, string[]>;
};

/** Each overridden skill: its facts and the phrases each needs, its closing and
 *  activation lines, and the text each step file must still contain for the
 *  facts that name it to make sense. */
export const SKILLS: Skill[] = [
  ...["gds-code-review", "bmad-code-review"].map((name) => ({
    name,
    twin: name.startsWith("gds") ? "bmad-code-review" : "gds-code-review",
    stepDir: "steps",
    facts: {
      "Hot-path gate:": [
        "{diff_output}",
        "CHECKPOINT",
        "search its importers (in the base commit too, for a deleted file)",
        "lists as not hot paths",
        "run this gate on the whole diff first",
        "whether this run includes the Hot-Path Auditor layer",
      ],
      "Hot-Path Auditor layer:": [
        "launches a fourth parallel subagent",
        "read access to the repository at the diff's head commit",
        "the prompt in section 9",
        "one Hot-Path Auditor per module or chunk",
        "appendix lines",
        "counts as a failed layer",
        "run that auditor once more",
        "{failed_layers}",
      ],
      "Hot-path triage:": [
        "never dismissed for being pre-existing",
        "dismiss only for a false positive as section 7 defines it",
        "always patch is patch",
        "decision_needed until the repository owner (maniator) answers, in spec mode and no-spec mode alike",
        "no choice dismisses, defers or skips an always-patch finding",
        "cannot give it",
        "does not change or only moves",
        "overrides two base rules",
        "{failed_layers}",
        "clean review",
      ],
      "Hot-path record:": [
        "before any choice is offered",
        "only when that covers the whole diff of the PR",
        "as a comment in every round",
        "{implementation_artifacts}",
        "does not count",
        "{failed_layers}",
      ],
    },
    onComplete: [
      "every HP item filled",
      "an appendix line for every changed function",
      "posted there as a comment",
      "does not count as the deep review",
    ],
    activation: [
      "Read sections 1, 6, 7 and 9 of docs/performance/hot-path-review.md now.",
    ],
    anchors: {
      "step-01-gather-context.md": [
        "CHECKPOINT",
        "{diff_output}",
        "chunk the review by file group",
      ],
      "step-02-review.md": ["{failed_layers}"],
      "step-03-triage.md": [
        "{failed_layers}",
        "Clean review",
        "decision_needed",
      ],
      "step-04-present.md": [
        "## On Complete",
        "### 4. Resolve decision",
        "Walk through each patch",
      ],
    },
  })),
  ...["gds-quick-dev", "bmad-quick-dev"].map((name) => ({
    name,
    twin: name.startsWith("gds") ? "bmad-quick-dev" : "gds-quick-dev",
    stepDir: "",
    facts: {
      "Hot-path review:": [
        "never reject",
        "intent_gap and bad_spec are only for findings that are not hot-path findings",
        "always patch stays patch",
        "HALT for the human on either route without reverting any code",
        "before the change is done and before merge",
      ],
    },
    onComplete: ["it is not done until", "hot-path record is on the PR"],
    activation: [],
    anchors: {
      "step-04-review.md": [
        "### Classify",
        "**reject**",
        "**intent_gap**",
        "**bad_spec**",
      ],
      "step-oneshot.md": ["### Classify", "**reject**"],
    },
  })),
];

export const SUMMARIES = [
  "CLAUDE.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "_bmad-output/project-context.md",
  ".github/copilot-instructions.md",
  ".github/skills/engine-parity-review/SKILL.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
];
