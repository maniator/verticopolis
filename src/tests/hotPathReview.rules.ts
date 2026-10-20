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
  "App build settings (which engine and code paths ship)": [
    "vite.config.ts",
    "src/build/",
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

/**
 * The code spans of section 1's not-hot-path list, in order. This pins the
 * list's wording; it is not an exclusion list (`engine-rs/src/` is here only
 * because the `*_tests.rs` files it names live there).
 */
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
    "apart from these, which are not hot paths even inside a listed path",
    "Only the HP-1 trace can show that, so the gate leaves this case to the Hot-Path Auditor.",
    "A load is a command, so the load path counts, and so does attach, which runs on every undo, redo and fault restore.",
    "The build files in the table do count",
    "joins the engine build row",
    "A port or a rewrite changes every line it adds, so all of it is in scope",
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
    "12 for a 30-minute `tick` sub-step",
    "under about 50,000 visits on the large tower",
    "stays under about 1,000 item visits on the large tower",
    "Ported, rewritten or moved code is reviewed as if it were new.",
    '"pre-existing" and "no new regression" do not close a finding',
    "Anything else is a dropped cache, which section 7 makes always `patch`",
    "does not close it",
    "Bypassing means computing what the cache holds without reading it",
    "Every other removal is a finding.",
    "the repository owner (maniator), the #1158 audit's assignee",
    "a port that turns a cached read into a copy is an HP-8 finding",
  ],
  "## 4. Measuring": [
    "A visit is one item read, compared, hashed, allocated or serialized",
  ],
  "## 5. The PR complexity note": [
    "Caches (HP-8): the caches, indexes and counters either engine has here",
  ],
  "## 6. Recording the review": [
    "| Item | Result | What was checked | Findings and resolution |",
    'A bare "checked" or "looks fine" does not count.',
    '"n/a" gives a reason tied to the diff.',
    "the record goes on it as a comment",
    "Whoever runs the review skill posts its record at step 4 of every round",
    "whoever opens the PR posts it there",
    "posts one record per group",
    "counts only when it covers the whole diff of the PR, or when the group records together cover it",
    "more than about 1,000 changed lines (added plus removed)",
    "the list of every changed file and function",
    "the run that launched them merges them into one record",
    "until every chunk has its table and every changed function its appendix line",
    "cannot give a GO or a CONDITIONAL GO on it",
    "A hot-path PR is signed off only when the record for its final commit is on the PR and its independent review is complete",
    "who is not Copilot or Codex",
    "A NO-GO, or a verdict on an earlier commit, does not sign it off.",
    "and the independent reviewer confirms that on the PR",
    "whose conditions it has confirmed met on the PR",
    "The PR's author requests the independent review",
    "changes nothing on a section 1 surface",
    "its record comes from the next round of the skill or from the independent reviewer's table",
    "A review that is still running is not complete, and auto-merge stays off until both hold",
  ],
  "## 7. Resolving a finding": [
    "A finding is never dismissed for being pre-existing",
    "the code is not reachable from an entry point",
    "is a finding whatever its count",
    "Two kinds are always `patch`",
    "code the PR adds, ports or rewrites that puts a whole-collection walk under any HP-2 multiplier",
    "a change that drops, removes or bypasses a cache, index or counter either engine has",
    "The false-positive test above does not apply to these two",
    "apart from the two removals HP-8 allows",
    "Section 1's list of code that is not a hot path still comes first",
    "A path changed inside a function body makes it a rewrite",
    "Any other change to a moved function makes it a rewrite.",
    "repository owner (maniator)",
    "neither a comment nor a review showing the owner as its author proves the acceptance on its own",
    "an acceptance another agent relays counts only as that quote",
    "gives no GO when it cannot",
    "Until then the finding stays `patch`, in spec mode and no-spec mode alike, marked pending the owner",
    "dismisses, defers or drops it",
    "halts for the human first instead",
  ],
  "## 9. How the review tools apply it": [
    "Copilot and Codex reviews do not stand in for it",
    "GO and CONDITIONAL GO need every row filled",
    "GO also needs every finding fixed or deferred under section 7",
    "that `CLAUDE.md` keeps its auto-merge rule",
  ],
};

/** The `CLAUDE.md` auto-merge rule that keeps a running review from being raced. */
export const AUTO_MERGE = [
  "Enable auto-merge only after the PR is signed off and CI is green",
  "hot-path or not, auto-merge stays off until that review has finished on the final commit",
  "A reviewer that is still running has not signed off.",
  "On a hot-path diff, signed off also needs the section 6 record",
  "a completed independent review of that commit, which the PR's author requests",
  "there is no GO or CONDITIONAL GO without that record",
];

/** Sentences of the Hot-Path Auditor prompt (section 9) the layer depends on. */
export const PROMPT = [
  "You are the Hot-Path Auditor.",
  "read it at the diff's head commit, `<commit>`",
  "trace its callers across every hot-path surface in section 1",
  "Check that the change keeps every cache, index and counter either engine has on these paths (the HP-8 table) and computes nothing one already answers",
  "list the TypeScript caches, indexes and counters for the same function and its callees",
  "Report pre-existing code too, marked pre-existing.",
  "Output the section 6 table with a row for every item",
  "Put each finding in the row of every item it falls under",
  "trace callers outside it through the list of changed files and functions and the repository",
  "add the section 6 appendix lines for its changed functions",
];

export const SKILL_ROOTS = [".claude/skills", ".agents/skills"];

/** The lines of each skill's SKILL.md that load the facts and run the activation step. */
export const SKILL_HOOKS = [
  "{workflow.persistent_facts}",
  "{workflow.activation_steps_append}",
];

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
        "lists as not hot paths by path",
        "only the auditor's caller trace can show it",
        "instruction 6 of steps/step-01-gather-context.md",
        "run this gate first on the whole diff, rebuilt from the source chosen in instruction 3",
        "whether this run includes the Hot-Path Auditor layer",
      ],
      "Hot-Path Auditor layer:": [
        "launches a fourth parallel subagent",
        "with <commit> replaced by the head commit's SHA and the repository's path added",
        "for a diff of staged or uncommitted changes it reads the working tree",
        "the prompt in section 9",
        "one Hot-Path Auditor per module or chunk",
        "counted over the whole diff even when this run covers one file group",
        "the list of every changed file and function",
        "merge them into one record",
        "appendix lines",
        "with an n/a that gives no reason",
        "counts as a failed layer, and so does a timeout",
        "run that auditor once more",
        "{failed_layers}",
      ],
      "Hot-path triage:": [
        "never dismissed for being pre-existing",
        "dismiss only for a false positive as section 7 defines it, which never applies to an always-patch finding",
        "always patch is patch",
        "it stays patch, marked pending the owner",
        "only the repository owner (maniator) can accept that deferral",
        "in spec mode and no-spec mode alike",
        "no choice dismisses, defers or skips an always-patch finding",
        "a session user who is not the owner cannot give it, and neither can another agent passing it on",
        "is not a decision_needed finding",
        "does not change or only moves",
        "a bullet in the Deferral inbox alone is not enough",
        "overrides the definition of defer",
        "{failed_layers}",
        "clean review",
      ],
      "Hot-path record:": [
        "before any choice is offered",
        "only when that covers the whole diff of the PR",
        "names its group",
        "as a comment in every round",
        "{implementation_artifacts}",
        "whoever opens the PR posts it there",
        "Each defer in the record names its issue",
        "does not count",
        "{failed_layers}",
      ],
    },
    onComplete: [
      "every HP item filled",
      "an appendix line for every changed or removed function",
      "names the groups still to review",
      "names its issue and backlog row",
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
        "6. Sanity check",
        "chunk the review by file group",
        "3. Construct `{diff_output}`",
      ],
      "step-02-review.md": ["{failed_layers}"],
      "step-03-triage.md": [
        "{failed_layers}",
        "Clean review",
        "Pre-existing issue not caused by the current change",
        "**decision_needed**",
      ],
      "step-04-present.md": [
        "{implementation_artifacts}",
        "findings must be resolved before handling `patch` findings",
        "Deferral inbox",
        "## On Complete",
        "### 4. Resolve decision",
        "Walk through each patch",
        "--key workflow.on_complete",
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
        "needs a tracking issue and a curated backlog row",
        "overrides both files' rule that a defer is pre-existing only and goes only to the Deferral inbox",
        "always patch stays patch",
        "HALT for the human on either route before acting on any other finding, without reverting any code",
        "resume when the human lets it be fixed or brings that acceptance",
        "it is not done until its hot-path record is on the PR",
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
        "pre-existing issue not caused by this story",
        "Deferral inbox",
      ],
      "step-oneshot.md": [
        "### Classify",
        "**reject**",
        "pre-existing issue not caused by this change",
        "Deferral inbox",
      ],
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
