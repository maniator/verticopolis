/**
 * The #1221 rollback rehearsal, the parts that need no browser and no files
 * (the Rollback row of #945, restated for the Rust-only build on 2026-11-03):
 * redeploy the previous build and confirm it loads the saves the newer build
 * wrote, with no unexpected data loss, and that the newer build then loads what
 * the previous one wrote. Three pieces:
 *
 * - {@link preflight} compares the two builds' compatibility records, so a
 *   save-format bump (which the flip release must not ship) fails before any
 *   engine runs.
 * - {@link diffSaves} and {@link judgeDiffs} compare two serialized towers
 *   field by field. The previous engine ignores a field it does not know, so a
 *   refusal is not the risk: the risk is a field the candidate wrote and the
 *   previous build silently drops (EX-1 in the exception register was one).
 *   Every difference must be named in the allowed-loss list with an exception
 *   id, or the rehearsal fails and the loss goes to the owner.
 * - {@link rehearseCase} runs one candidate-written save through the previous
 *   engine (read, play, save) and back into the candidate.
 *
 * Node only and ERASABLE (see scripts/screenshot-env.ts) so
 * `scripts/rollback-rehearsal.ts` runs under plain `node`; never imported by the
 * app. The procedure is `_bmad-output/planning-artifacts/release-3.0-rollback-rehearsal.md`.
 */
import { isSemverIncrease, type CompatRecord } from "./engineCompat.ts";

/** The path of a value in a save, with every array index written as `[]`. */
export type SavePath = string;

export type DiffKind = "dropped" | "changed" | "added";

export interface DiffEntry {
  kind: DiffKind;
  path: SavePath;
  /** How many places in the save differ at this path. */
  count: number;
  /** The first place, with its real indices and a short preview of both values. */
  example: string;
}

/** A difference the owner accepted, tied to an entry of the exception register. */
export interface AllowedLoss {
  /** The register entry, for example `EX-1`. */
  id: string;
  kind: DiffKind;
  path: SavePath;
  reason: string;
}

export type Level = "fail" | "note";

export interface Finding {
  level: Level;
  message: string;
}

const PREVIEW_CHARS = 60;
const MAX_DEPTH = 64;

const preview = (v: unknown): string => {
  if (v === undefined) return "(absent)";
  const text = JSON.stringify(v) ?? String(v);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}...` : text;
};

/** An own property, so keys like `constructor` or `toString` are not mistaken for inherited ones. */
const has = (o: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** The size of a save in UTF-8 bytes, which is what is stored (`string.length` counts UTF-16 units). */
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Compare two parsed saves. `dropped` is a path `before` has and `after` lacks,
 * `added` the reverse, `changed` a value that differs (a list of another length
 * is one `changed` entry at the list's own path). Numbers compare as numbers, so
 * `1` and `1.0` are the same.
 */
export function diffSaves(before: unknown, after: unknown): DiffEntry[] {
  const found = new Map<string, DiffEntry>();
  const note = (kind: DiffKind, path: string, where: string, a: unknown, b: unknown): void => {
    const key = `${kind} ${path}`;
    const seen = found.get(key);
    if (seen) {
      seen.count += 1;
      return;
    }
    found.set(key, { kind, path, count: 1, example: `${where}: ${preview(a)} -> ${preview(b)}` });
  };
  const walk = (a: unknown, b: unknown, path: string, where: string, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error(`save nests deeper than ${MAX_DEPTH} levels at ${where}`);
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) note("changed", `${path}[] length`, where, a.length, b.length);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${path}[]`, `${where}[${i}]`, depth + 1);
      return;
    }
    if (isRecord(a) && isRecord(b)) {
      for (const key of Object.keys(a)) {
        const next = path === "" ? key : `${path}.${key}`;
        if (!has(b, key)) note("dropped", next, `${where}.${key}`.replace(/^\./, ""), a[key], undefined);
        else walk(a[key], b[key], next, `${where}.${key}`.replace(/^\./, ""), depth + 1);
      }
      for (const key of Object.keys(b)) {
        if (has(a, key)) continue;
        note("added", path === "" ? key : `${path}.${key}`, `${where}.${key}`.replace(/^\./, ""), undefined, b[key]);
      }
      return;
    }
    if (a !== b) note("changed", path === "" ? "(root)" : path, where || "(root)", a, b);
  };
  walk(before, after, "", "", 0);
  return [...found.values()];
}

export interface Judgement {
  /** Dropped or changed entries nobody accepted: the rehearsal fails on these. */
  unexplained: DiffEntry[];
  /** Entries the allowed-loss list names, with the exception that covers each. */
  explained: { entry: DiffEntry; allowed: AllowedLoss }[];
  /** Entries a previous build added (defaults it fills in); never a failure, and not printed in the report (the JSON report keeps them). */
  added: DiffEntry[];
}

/** Sort diff entries into the ones the owner has accepted and the ones to fail on. */
export function judgeDiffs(entries: readonly DiffEntry[], allowed: readonly AllowedLoss[]): Judgement {
  const out: Judgement = { unexplained: [], explained: [], added: [] };
  for (const entry of entries) {
    if (entry.kind === "added") {
      out.added.push(entry);
      continue;
    }
    const match = allowed.find((a) => a.kind === entry.kind && a.path === entry.path);
    if (match) out.explained.push({ entry, allowed: match });
    else out.unexplained.push(entry);
  }
  return out;
}

/** Allowed-loss entries no rehearsal case matched: an exception that no longer happens should leave the list. */
export function staleAllowances(allowed: readonly AllowedLoss[], cases: readonly CaseResult[]): AllowedLoss[] {
  const used = new Set<AllowedLoss>();
  for (const c of cases) for (const step of c.steps) for (const e of step.judgement?.explained ?? []) used.add(e.allowed);
  return allowed.filter((a) => !used.has(a));
}

/** Check an allowed-loss list read from disk; each entry must name its exception and say why. */
export function parseAllowedLosses(raw: unknown): AllowedLoss[] {
  if (!Array.isArray(raw)) throw new Error("the allowed-loss list must be a JSON array");
  return raw.map((item, i) => {
    const row = isRecord(item) ? item : {};
    const { id, kind, path, reason } = row;
    if (typeof id !== "string" || !/^EX-\d+$/.test(id)) throw new Error(`allowed loss ${i}: id must be an exception register id such as EX-1`);
    if (kind !== "dropped" && kind !== "changed") throw new Error(`allowed loss ${i} (${id}): kind must be "dropped" or "changed"`);
    if (typeof path !== "string" || path === "") throw new Error(`allowed loss ${i} (${id}): path is required`);
    if (typeof reason !== "string" || reason.trim() === "") throw new Error(`allowed loss ${i} (${id}): a reason is required`);
    return { id, kind, path, reason };
  });
}

/** The two builds under test, as their compatibility records and app versions. */
export interface BuildFacts {
  label: string;
  appVersion: string;
  compat: CompatRecord;
}

/**
 * What the two builds' records say before any engine runs. A candidate that
 * writes a newer save version than the previous build writes fails: the flip
 * release ships no save-format bump (#945 Rollback row).
 */
export function preflight(previous: BuildFacts, candidate: BuildFacts): Finding[] {
  const out: Finding[] = [];
  const p = previous.compat;
  const c = candidate.compat;
  if (!isSemverIncrease(p.crateVersion, c.crateVersion) && p.crateVersion !== c.crateVersion) {
    out.push({ level: "fail", message: `the previous build's engine crate (${p.crateVersion}) is newer than the candidate's (${c.crateVersion}); the arguments may be swapped` });
  }
  if (c.saveVersion > p.saveVersion) {
    out.push({ level: "fail", message: `the candidate writes save version ${c.saveVersion} and the previous build writes ${p.saveVersion}: a save-format bump ships in this release, so a rollback loses the format` });
  } else if (c.saveVersion < p.saveVersion) {
    out.push({ level: "note", message: `the candidate writes save version ${c.saveVersion}, older than the previous build's ${p.saveVersion}; check the arguments` });
  } else {
    out.push({ level: "note", message: `both builds write save version ${c.saveVersion}` });
  }
  if (c.oldestSaveVersion > p.oldestSaveVersion) {
    out.push({ level: "note", message: `the candidate no longer loads save versions below ${c.oldestSaveVersion} (the previous build still loads from ${p.oldestSaveVersion}); only a very old save that the previous build rewrote could be affected` });
  }
  const layouts: [string, number, number][] = [
    ["frame layout", p.frameLayoutVersion, c.frameLayoutVersion],
    ["view layout", p.viewLayoutVersion, c.viewLayoutVersion],
    ["catalog", p.catalogVersion, c.catalogVersion],
    ["identity record", p.identitySchema, c.identitySchema],
  ];
  for (const [name, a, b] of layouts) {
    if (a !== b) out.push({ level: "note", message: `the ${name} version differs (${a} then ${b}); each build must be served with its own engine package as a set, which the package check enforces` });
  }
  if (previous.appVersion === candidate.appVersion) {
    out.push({ level: "note", message: `both builds report app version ${previous.appVersion}; the browser rehearsal tells them apart by commit` });
  }
  return out;
}

/** The slice of an engine the rehearsal drives. A test double can stand in for it. */
export interface EngineHandle {
  serialize(): string;
  /** Advance the clock by this many game minutes. */
  tick(minutes: number): void;
  free(): void;
}

/** One build's engine package: a way to start an engine from save text, which throws when the engine refuses it. */
export interface EnginePackage {
  label: string;
  fromSave(text: string): EngineHandle;
}

export type StepName = "candidate-read" | "previous-load" | "previous-read" | "previous-play" | "roll-forward" | "case-error";

export interface StepResult {
  step: StepName;
  ok: boolean;
  /** Why the step failed outright (a refusal or a trap), when it did. */
  error?: string;
  judgement?: Judgement;
}

export interface CaseResult {
  name: string;
  /** Bytes of the candidate-written save. */
  bytes: number;
  steps: StepResult[];
  ok: boolean;
}

export interface CaseOptions {
  /** Game hours the previous build plays before it saves. */
  hours: number;
  allowed: readonly AllowedLoss[];
}

/** The tick the rehearsal uses: two game minutes, the step the perf harnesses use. */
const STEP_MINUTES = 2;
const MINUTES_PER_HOUR = 60;

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function tryLoad(pkg: EnginePackage, text: string): { engine?: EngineHandle; error?: string } {
  try {
    return { engine: pkg.fromSave(text) };
  } catch (e) {
    return { error: `${pkg.label} refused the save: ${reason(e)}` };
  }
}

/** What the candidate makes of its own save when it loads and serializes it with no play. */
function candidateReading(candidate: EnginePackage, text: string): { value?: unknown; error?: string } {
  const loaded = tryLoad(candidate, text);
  if (!loaded.engine) return { error: loaded.error };
  try {
    return serialized(loaded.engine, candidate.label);
  } finally {
    loaded.engine.free();
  }
}

/** The engine's serialized tower, parsed; a trap inside `serialize` fails the one case, not the run. */
function serialized(engine: EngineHandle, where: string): { value?: unknown; error?: string } {
  try {
    return tryParse(engine.serialize(), where);
  } catch (e) {
    return { error: `${where} failed while serializing: ${reason(e)}` };
  }
}

function tryParse(text: string, where: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `${where} wrote text that is not JSON: ${reason(e)}` };
  }
}

/**
 * One candidate-written save through the previous build and back.
 * 1. The candidate loads its own save and serializes it at once: this is what
 *    the candidate itself makes of the tower, the baseline for step 3. (A
 *    save is not always a fixed point of load and serialize, so a comparison
 *    with the raw text would blame the previous build for the candidate's own
 *    normalization.)
 * 2. The previous engine loads the save (a refusal fails the case).
 * 3. With no play at all, it serializes, and the result is compared with the
 *    baseline: whatever it dropped or changed is a loss.
 * 4. It plays `hours` game hours (a trap fails the case) and serializes again.
 * 5. The candidate loads that and serializes it; the candidate must keep every
 *    field the previous build wrote.
 */
export function rehearseCase(name: string, candidateSave: string, previous: EnginePackage, candidate: EnginePackage, opts: CaseOptions): CaseResult {
  try {
    return rehearseCaseUnguarded(name, candidateSave, previous, candidate, opts);
  } catch (e) {
    // Anything the steps did not catch (a trap while freeing, a save nested too deep to diff) fails this tower, never the whole run.
    return { name, bytes: utf8Bytes(candidateSave), steps: [{ step: "case-error", ok: false, error: `the rehearsal of this tower stopped: ${reason(e)}` }], ok: false };
  }
}

function rehearseCaseUnguarded(name: string, candidateSave: string, previous: EnginePackage, candidate: EnginePackage, opts: CaseOptions): CaseResult {
  const steps: StepResult[] = [];
  const finish = (): CaseResult => ({
    name,
    bytes: utf8Bytes(candidateSave),
    steps,
    ok: steps.every((s) => s.ok),
  });
  const baseline = candidateReading(candidate, candidateSave);
  if (baseline.error) {
    steps.push({ step: "candidate-read", ok: false, error: baseline.error });
    return finish();
  }
  steps.push({ step: "candidate-read", ok: true });

  const loaded = tryLoad(previous, candidateSave);
  if (!loaded.engine) {
    steps.push({ step: "previous-load", ok: false, error: loaded.error });
    return finish();
  }
  steps.push({ step: "previous-load", ok: true });
  const engine = loaded.engine;
  let played = "";
  try {
    const read = serialized(engine, previous.label);
    if (read.error) {
      steps.push({ step: "previous-read", ok: false, error: read.error });
      return finish();
    }
    const readJudgement = judgeDiffs(diffSaves(baseline.value, read.value), opts.allowed);
    steps.push({ step: "previous-read", ok: readJudgement.unexplained.length === 0, judgement: readJudgement });

    try {
      const steps2 = Math.ceil((opts.hours * MINUTES_PER_HOUR) / STEP_MINUTES);
      for (let i = 0; i < steps2; i++) engine.tick(STEP_MINUTES);
      played = engine.serialize();
      steps.push({ step: "previous-play", ok: true });
    } catch (e) {
      steps.push({ step: "previous-play", ok: false, error: `${previous.label} failed while playing: ${reason(e)}` });
      return finish();
    }
  } finally {
    engine.free();
  }

  const back = tryLoad(candidate, played);
  if (!back.engine) {
    steps.push({ step: "roll-forward", ok: false, error: back.error });
    return finish();
  }
  try {
    const playedValue = tryParse(played, previous.label);
    const again = serialized(back.engine, candidate.label);
    if (playedValue.error || again.error) {
      steps.push({ step: "roll-forward", ok: false, error: playedValue.error ?? again.error });
      return finish();
    }
    const judgement = judgeDiffs(diffSaves(playedValue.value, again.value), opts.allowed);
    steps.push({ step: "roll-forward", ok: judgement.unexplained.length === 0, judgement });
  } finally {
    back.engine.free();
  }
  return finish();
}

export interface RehearsalReport {
  previous: BuildFacts;
  candidate: BuildFacts;
  hours: number;
  findings: Finding[];
  cases: CaseResult[];
  stale: AllowedLoss[];
  /** True when preflight has no failure and every case passed. */
  ok: boolean;
}

/** Put the preflight, the cases and the stale-allowance check into one verdict. */
export function buildReport(previous: BuildFacts, candidate: BuildFacts, hours: number, cases: CaseResult[], allowed: readonly AllowedLoss[]): RehearsalReport {
  const findings = preflight(previous, candidate);
  const stale = staleAllowances(allowed, cases);
  const ok = findings.every((f) => f.level !== "fail") && cases.length > 0 && cases.every((c) => c.ok);
  return { previous, candidate, hours, findings, cases, stale, ok };
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The report as Markdown, for pasting on #945's Rollback row. */
export function renderReport(r: RehearsalReport): string {
  const lines: string[] = [];
  lines.push(`# Rollback rehearsal, engine layer: ${r.ok ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push(`- Previous build: ${r.previous.label} (app ${r.previous.appVersion}, engine crate ${r.previous.compat.crateVersion}, save version ${r.previous.compat.saveVersion})`);
  lines.push(`- Candidate build: ${r.candidate.label} (app ${r.candidate.appVersion}, engine crate ${r.candidate.compat.crateVersion}, save version ${r.candidate.compat.saveVersion})`);
  lines.push(`- The previous build plays ${r.hours} game hours of each candidate-written tower before it saves.`);
  lines.push("");
  lines.push("## Preflight");
  lines.push("");
  for (const f of r.findings) lines.push(`- ${f.level === "fail" ? "FAIL" : "note"}: ${f.message}`);
  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| Tower | Bytes | Candidate reads | Previous loads | Previous read | Previous plays | Roll forward | Unexplained | Accepted |");
  lines.push("| --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |");
  for (const c of r.cases) {
    const mark = (s: StepName): string => {
      const step = c.steps.find((x) => x.step === s);
      if (step === undefined) return "not run";
      return step.ok ? "ok" : "FAIL";
    };
    const unexplained = c.steps.reduce((n, s) => n + (s.judgement?.unexplained.length ?? 0), 0);
    const accepted = c.steps.reduce((n, s) => n + (s.judgement?.explained.length ?? 0), 0);
    lines.push(`| ${cell(c.name)} | ${c.bytes} | ${mark("candidate-read")} | ${mark("previous-load")} | ${mark("previous-read")} | ${mark("previous-play")} | ${mark("roll-forward")} | ${unexplained} | ${accepted} |`);
  }
  const detail = r.cases.filter((c) => !c.ok || c.steps.some((s) => (s.judgement?.explained.length ?? 0) > 0));
  if (detail.length > 0) {
    lines.push("");
    lines.push("## Losses and failures");
    for (const c of detail) {
      lines.push("");
      lines.push(`### ${c.name}`);
      for (const s of c.steps) {
        if (s.error) lines.push(`- ${s.step}: ${s.error}`);
        for (const e of s.judgement?.unexplained ?? []) lines.push(`- ${s.step}: UNEXPLAINED ${e.kind} \`${e.path}\` (${e.count}), first at ${cell(e.example)}`);
        for (const { entry, allowed } of s.judgement?.explained ?? []) lines.push(`- ${s.step}: accepted ${entry.kind} \`${entry.path}\` (${entry.count}) under ${allowed.id}: ${allowed.reason}`);
      }
    }
  }
  if (r.stale.length > 0) {
    lines.push("");
    lines.push("## Allowed losses that no case hit");
    lines.push("");
    for (const a of r.stale) lines.push(`- ${a.id} ${a.kind} \`${a.path}\`: remove it if the exception no longer applies`);
  }
  lines.push("");
  lines.push("Any UNEXPLAINED loss goes to the owner before the gate review (issue #1221, acceptance).");
  return `${lines.join("\n")}\n`;
}
