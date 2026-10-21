/**
 * The cohorts of the governed reliability definition (#1090; the owner's
 * direction of 2026-10-20, section 5), beside the overall rate in
 * `engine-reliability.mjs`. `src/engine-reliability-cohorts.test.ts` and
 * `src/engine-reliability-cohorts-report.test.ts` pin every rule; change a
 * rule here and in the tests together, or not at all.
 *
 * The populations are kept apart so a failure before engagement never turns
 * into missing data and a zero-second page load never turns into a clean
 * success. Only recognized page lives count (the overall rate's rule); the
 * rest are counted on their own line. The narrowing flags (`--shas`,
 * `--versions`, `--builds`, `--arms`) apply only to the overall rate.
 *
 * - ALL ATTEMPTS, the safety denominator: every session with a page life that
 *   asked for a counted WASM host, overrides included; a settled page life
 *   must have run the engine, and a size-gated one counts only when it
 *   faulted or engaged on the engine. Every `wasm`-arm session with a page
 *   life that an opt-out (a setting or the URL choosing TypeScript) or a
 *   safety suppression moved to TypeScript is counted in the WASM arm's row;
 *   one that never ran the engine is outside the rate's N, since it cannot
 *   fault and would make the rate look cleaner than the engine is. #1197
 *   words it the other way, so the report also prints the rate with them in
 *   N; which reading the gate uses is pending the owner. A suppressed page
 *   life with an engine-fault reason (the boot that detected a crash loop) is
 *   a fault on the host it names, size gate or not, never a move off, and a
 *   same-session loop on an eligible commit is charged to the cohorts too.
 *   Sessions on an uncounted WASM host are counted on their own line. A
 *   session's arm is that of its first page life in the window that carries
 *   one (`none`, a build with no cohort, is skipped). Every engine fault
 *   counts, engaged or not; a page life with an `attempt` row and no `settle`
 *   row left before its first tower, which may be a crash while the package
 *   loaded: it is reported beside the faults, and a second, pessimistic bound
 *   counts it as one.
 * - No session with an override page life (a setting or the URL chose either
 *   engine, an opt-out included) is in the eligible populations below, since
 *   overridden sessions never qualify. Its faults stay in all attempts, and
 *   the report counts the sessions left out and how many of them faulted.
 * - ELIGIBLE ATTEMPTS: the `wasm`-arm sessions with an eligible page life
 *   (below) that settled or made an attempt, engaged or not: the cohort's
 *   denominator before the engagement condition, so a fault that stopped the
 *   player engaging shows here.
 * - The ENGAGED ELIGIBLE COHORT, the 1,000-session gate's unit (the owner,
 *   2026-10-21): a `wasm`-arm session with an eligible page life that engaged
 *   on the engine. A page life is eligible on the production host (`wasm`), on
 *   a commit the gate review names (one with S4, S9 and the slice-10 facade,
 *   where the old mirror host cannot run under `wasm`), at stage 3, chosen by
 *   the cohort (a setting, a URL or the safety latch never qualifies), not
 *   suppressed, not size-gated, settled, and having run the engine (a settle
 *   that already fell back on `package-mismatch` alone did not). It engaged
 *   when its `engaged` row says a WASM engine was running. A fault in any
 *   eligible page life of the session counts, one before the engagement
 *   included. Its rate and bounds are conditional on engagement, so it is read
 *   beside the attempts rows, which keep every failure before engagement.
 * - The TAIL: the eligible attempts and the engaged cohort on the commits the
 *   candidate review names.
 *
 * The arm comparison reads, by stage and assigned arm, every session with a
 * settled page life (until both arms send the `attempt` row) and none that
 * was size-gated (the gate is computed in both arms, and `$exception` rows
 * carry no page life, so the whole session is left out), overrides, opt-outs
 * and suppressions included: sessions, the share that engaged on any engine,
 * engine-fault sessions and `$exception` sessions of any source, with the
 * 95% interval of the crash-rate difference (Newcombe's hybrid score
 * interval). Sessions whose arm or stage changed are reported apart. The stop
 * signals are a repeated engine-fault reason on one build in two sessions and
 * a writer latch-off, both read from every recognized page life (any host,
 * size gate or arm), and a crash-rate difference (wasm minus ts) whose
 * interval lies above zero at some stage. A repeated `$exception` is not
 * evaluated: production stacks are minified and the rows carry no commit.
 *
 * The A4 fields (`stage`, `assigned_arm`, `selected_by`, `safety_suppressed`,
 * `size_gated`) and the `attempt` and `engaged` rows are not sent by any build
 * yet. Absent, they read as `none`, `none`, `default`, false, false, no
 * attempt row and not engaged, so nothing is eligible and the report says so
 * at its top. A row counts as measured on a build (commit and bundle) once
 * any page life of that build sent it: a page life that left early or never
 * engaged sends none by design.
 *
 * This module and `engine-reliability.mjs` import each other; every
 * cross-reference is read inside a function, and must stay so (a module-scope
 * use would meet an uninitialized binding).
 */

import { recognized, shaMatches, upperBound } from "./engine-reliability.mjs";

/** The `selected_by` values that make a page life an override: the player
 *  chose either engine (Settings) or the URL did; an opt-out is one too. */
export const OVERRIDE_SELECTIONS = ["setting", "url"];

/** The only stage whose page lives can be eligible, as `stage` reads. */
export const ELIGIBLE_STAGE = "3";

/** The host an eligible page life must ask for: the production main-thread
 *  host. Until slice 11 removes the mirror, this value also names the old
 *  mirror host, so only the commits the gate review names (`--eligible-shas`)
 *  make it the facade. */
export const ELIGIBLE_HOST = "wasm";

/** The `engine` values that mean the engine ran when the page life engaged. */
export const ENGINE_RUNNING = ["wasm", "wasm-frame", "wasm-worker"];

/** The arms the comparison reports, in order. */
export const COMPARED_ARMS = ["wasm", "ts"];

/** Whether the player or the URL chose this page life's engine. */
export const isOverride = (pl) => OVERRIDE_SELECTIONS.includes(pl.selectedBy);

/** Whether the page life fell back for an engine fault: any reason but
 *  `package-mismatch`, or no reason at all with its rows lost. */
export function isFault(pl) {
  const faultReasons = pl.reasons.filter((r) => r !== "package-mismatch");
  return pl.fallbacks > 0 && (faultReasons.length > 0 || pl.reasons.length === 0);
}

/** Whether a page life got past its settle row: settled, or a row that only
 *  comes after it (an engaged row, a later fallback or a latch-off) proves it
 *  did when the settle row was lost. */
const pastSettle = (pl) => pl.settled || pl.engaged || pl.fallbacks > pl.settleFallbacks || pl.writerLatched;

/** Whether a page life ran the engine: one whose settle row already fell
 *  back on `package-mismatch` alone never did. */
export const ranEngine = (pl) => pastSettle(pl) && !(pl.settleFallbacks > 0 && !isFault(pl) && pl.reasons.includes("package-mismatch"));

const leftBeforeTower = (pl) => pl.attempted && !pastSettle(pl);

/** Whether a page life reports an engine fault by its reasons or its count:
 *  any reason but `package-mismatch`, even with no fallback counted (a boot
 *  that detected a crash loop under an override may send one so). */
const faultReason = (pl) => isFault(pl) || pl.reasons.some((r) => r !== "package-mismatch");

/** Whether a safety suppression moved the page life to TypeScript: the flag,
 *  or the selection (A4 may fold one into the other). */
export const isSuppressed = (pl) => pl.safetySuppressed || pl.selectedBy === "safety";

/** Whether a suppressed page life carries an engine-fault reason: the boot
 *  that detects a crash loop reports it (A4's `unclean-exit`) on a page life
 *  that then runs TypeScript, so the fault belongs to the engine. */
export const suppressedFault = (pl) => isSuppressed(pl) && faultReason(pl);

/** Whether a page life carries an engine fault: a fault fallback, or a crash
 *  loop a suppressed boot detected. Every table reads this one rule. */
export const engineFault = (pl) => isFault(pl) || faultReason(pl);

/** Whether a page life is eligible evidence (before engagement), or, with
 *  `settledOrNot`, would be had it reached its first tower. A settled page
 *  life that never ran the engine is neither; an `engaged` row stands in for
 *  a lost settle row. */
export function isEligible(pl, eligibleShas, settledOrNot = false) {
  return (
    pl.requested === ELIGIBLE_HOST &&
    shaMatches(pl.sha, eligibleShas) &&
    pl.stage === ELIGIBLE_STAGE &&
    pl.assignedArm === "wasm" &&
    pl.selectedBy === "cohort" &&
    !isSuppressed(pl) &&
    !pl.sizeGated &&
    (settledOrNot && !pastSettle(pl) ? pl.attempted : ranEngine(pl))
  );
}

/** Whether the page life engaged with the engine running. */
export const engagedOnEngine = (pl) => pl.engaged && ENGINE_RUNNING.includes(pl.engagedEngine);

/** A page life's time, for ordering: unparseable or missing sorts last. */
const when = (pl) => {
  const t = Date.parse(String(pl.firstSeen).replace(" ", "T"));
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** Group page lives by session, oldest first (ties by page life id), and give
 *  each session the arm of its first page life that carries one. */
function bySession(pageLives) {
  const sessions = new Map();
  for (const pl of pageLives) {
    if (!sessions.has(pl.session)) sessions.set(pl.session, []);
    sessions.get(pl.session).push(pl);
  }
  return [...sessions.entries()].map(([id, lives]) => {
    lives.sort((a, b) => when(a) - when(b) || (a.pageLife < b.pageLife ? -1 : a.pageLife > b.pageLife ? 1 : 0));
    const armed = lives.filter((pl) => pl.assignedArm !== "none");
    const first = armed[0] ?? lives[0];
    const arm = first.assignedArm;
    return { id, lives, arm, stage: first.stage, changed: armed.some((pl) => pl.assignedArm !== arm || pl.stage !== first.stage) };
  });
}

/** One build's key, as the overall rate names it. */
const buildKey = (pl) => `${pl.version} (${pl.sha}, ${pl.build})`;

/** Count one cohort: `wasm`-arm sessions with a page life `pick` keeps that
 *  engaged on the engine (or any such page life, without `engagedOnly`);
 *  `pickLoading` finds the ones that left before a tower, and `pickLoop` the
 *  crash loops a suppressed boot of the same session detected (a same-tab
 *  reload keeps the session), which are charged to it as faults. A session
 *  with an override page life never qualifies; `overridden` counts those,
 *  and `overriddenFaults` the ones a fault the cohort would hold. */
function cohort(sessions, pick, pickLoading, pickLoop, engagedOnly = true) {
  const out = { n: 0, faults: 0, faultsOrLeft: 0, latched: 0, leftBeforeTower: 0, overridden: 0, overriddenFaults: 0, byEngagement: { command: 0, play: 0, unknown: 0, none: 0 } };
  const byBuild = new Map();
  for (const s of sessions) {
    if (s.arm !== "wasm") continue;
    const lives = s.lives.filter(pick);
    const engaged = lives.filter(engagedOnEngine);
    if (engagedOnly ? !engaged.length : !lives.length) continue;
    if (s.lives.some(isOverride)) {
      out.overridden++;
      if (lives.some(engineFault) || s.lives.some(pickLoop)) out.overriddenFaults++;
      continue;
    }
    out.n++;
    const loops = s.lives.filter(pickLoop);
    const fault = lives.some(engineFault) || loops.length > 0;
    const left = s.lives.some((pl) => leftBeforeTower(pl) && pickLoading(pl));
    if (fault) out.faults++;
    if (fault || left) out.faultsOrLeft++;
    if (lives.some((pl) => pl.writerLatched)) out.latched++;
    if (left) out.leftBeforeTower++;
    // `none` never engaged; an engaged row with no route is `unknown`.
    const by = engaged[0]?.engagedBy;
    out.byEngagement[!engaged.length ? "none" : by === "command" || by === "play" ? by : "unknown"]++;
    // A build holds the session only where it engaged or faulted, so a page
    // load that never played a build is never its clean session.
    for (const pl of [...(engagedOnly ? lives.filter((x) => engagedOnEngine(x) || engineFault(x)) : lives), ...loops]) {
      const b = byBuild.get(buildKey(pl)) ?? { build: buildKey(pl), sessions: new Set(), faults: new Set() };
      byBuild.set(b.build, b);
      b.sessions.add(s.id);
      if (engineFault(pl)) b.faults.add(s.id);
    }
  }
  return {
    ...out,
    rate: out.n ? out.faults / out.n : null,
    upper95: upperBound(out.faults, out.n),
    upper95Pessimistic: upperBound(out.faultsOrLeft, out.n),
    byBuild: [...byBuild.values()].map((b) => ({ build: b.build, sessions: b.sessions.size, faults: b.faults.size, upper95: upperBound(b.faults.size, b.sessions.size) })).sort((a, b) => a.build.localeCompare(b.build)),
  };
}

/** The all-attempts row with the moved-off sessions that never ran the
 *  engine in N as clean sessions (#1197's wording). */
function withMovedOff(t) {
  const n = t.sessions + t.movedOffNeverRan;
  return { n, faults: t.faults, rate: n ? t.faults / n : null, upper95: upperBound(t.faults, n), upper95Pessimistic: upperBound(t.faultsOrLeft, n), latched: t.latched, leftBeforeTower: t.leftBeforeTower };
}

/** Wilson score interval for k of n at 95%. */
function wilson(k, n) {
  const z = 1.959963984540054;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

/** The 95% interval of p1 - p2 (Newcombe's hybrid score method), or null
 *  when either arm is empty. */
export function differenceInterval(k1, n1, k2, n2) {
  if (!(n1 > 0) || !(n2 > 0)) return null;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const [l1, u1] = wilson(k1, n1);
  const [l2, u2] = wilson(k2, n2);
  const d = p1 - p2;
  return [d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)];
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const code = (v) => `\`${v}\``;

/** How many of `lives` carry a field. */
const coverage = (lives, has) => ({ with: lives.filter(has).length, of: lives.length });

/** How many of `lives` are on a build that sent a row kind at least once. */
function buildCoverage(lives, has) {
  const sending = new Set(lives.filter(has).map(buildKey));
  return coverage(lives, (pl) => sending.has(buildKey(pl)));
}

/**
 * Sort page lives into the three populations and the arm comparison.
 * `opts.hosts` are the hosts an attempt asks for (default `wasm`);
 * `eligibleShas` and `tailShas` are the commits the gate and candidate
 * reviews name (none named: nothing is eligible); `crashSessions` is the set
 * of sessions with an `$exception` in the window.
 */
export function summarizeCohorts(allLives, opts = {}) {
  const hosts = opts.hosts ?? [ELIGIBLE_HOST];
  const eligibleShas = opts.eligibleShas ?? [];
  if (eligibleShas.length && !hosts.includes(ELIGIBLE_HOST)) throw new Error(`eligible commits need the counted hosts to include \`${ELIGIBLE_HOST}\``);
  const tailShas = opts.tailShas ?? [];
  const crashSessions = opts.crashSessions ?? new Set();
  const pageLives = allLives.filter(recognized);
  const unrecognizedSessions = new Set(allLives.filter((pl) => !recognized(pl)).map((pl) => pl.session)).size;
  const sessions = bySession(pageLives);

  // A page life asked for the engine on a counted host unless a suppression
  // moved it to TypeScript, and ran it if it settled (a settle that fell back
  // on `package-mismatch` alone never did; the overall rate counts those). A
  // size-gated page life counts only once the engine faulted or engaged in it
  // (a gated load, then a new game on the engine). An opt-out is a setting or
  // URL choice of TypeScript in the `wasm` arm, and belongs to the production
  // host; a choice of an uncounted WASM host is in no population here. A
  // suppressed page life with an engine-fault reason (a detected crash loop)
  // is an attempt with a fault on the host its row names (A4: the selection
  // before safety), size gate or not, since large towers are the likeliest to
  // take the engine down; one that names `ts` in the `wasm` arm belongs to
  // the production host.
  const loopHost = (pl) => hosts.includes(pl.requested) || (pl.requested === "ts" && pl.assignedArm === "wasm" && hosts.includes(ELIGIBLE_HOST));
  const asked = (pl) =>
    (hosts.includes(pl.requested) && !isSuppressed(pl) && (pl.settled ? ranEngine(pl) : pl.attempted) && (!pl.sizeGated || engineFault(pl) || engagedOnEngine(pl))) || (suppressedFault(pl) && loopHost(pl));
  const movedOff = (pl) => hosts.includes(ELIGIBLE_HOST) && pl.assignedArm === "wasm" && !pl.sizeGated && !engineFault(pl) && (isSuppressed(pl) || (isOverride(pl) && pl.requested === "ts"));
  const uncountedWasm = (pl) => pl.requested.startsWith("wasm") && !hosts.includes(pl.requested);
  let uncountedHostSessions = 0;
  let uncountedHostFaults = 0;
  const attemptsByArm = new Map();
  const blank = (arm) => ({ arm, sessions: 0, faults: 0, faultsOrLeft: 0, engaged: 0, faultNotEngaged: 0, leftBeforeTower: 0, overrides: 0, movedOff: 0, movedOffNeverRan: 0, latched: 0 });
  const rowOf = (arm) => attemptsByArm.get(arm) ?? attemptsByArm.set(arm, blank(arm)).get(arm);
  const totals = blank("all");
  const repeats = new Map();
  for (const s of sessions) {
    const lives = s.lives.filter(asked);
    // An opt-out shows in the WASM arm, whether the session ran the engine or not.
    const wasMovedOff = s.arm === "wasm" && s.lives.some(movedOff);
    if (!lives.length) {
      if (s.lives.some(uncountedWasm)) {
        uncountedHostSessions++;
        if (s.lives.some((pl) => uncountedWasm(pl) && engineFault(pl))) uncountedHostFaults++;
      } else if (wasMovedOff)
        for (const t of [rowOf(s.arm), totals]) {
          t.movedOff++;
          t.movedOffNeverRan++;
        }
      continue;
    }
    const fault = lives.some(engineFault);
    const engaged = lives.some(engagedOnEngine);
    const left = lives.some(leftBeforeTower);
    const row = rowOf(s.arm);
    for (const t of [row, totals]) {
      t.sessions++;
      if (fault) t.faults++;
      if (fault || left) t.faultsOrLeft++;
      if (engaged) t.engaged++;
      if (fault && !engaged) t.faultNotEngaged++;
      if (left) t.leftBeforeTower++;
      if (s.lives.some((pl) => isOverride(pl) && !movedOff(pl))) t.overrides++;
      if (wasMovedOff) t.movedOff++;
      if (lives.some((pl) => pl.writerLatched)) t.latched++;
    }
  }
  // Repeats read every recognized page life (any host, size gate or arm), as
  // the latch-off signal does: a shared-core fault can show through any host.
  for (const pl of pageLives.filter(engineFault)) {
    const reasons = pl.reasons.filter((x) => x !== "package-mismatch");
    for (const r of reasons.length ? reasons : ["no reason sent"]) {
      const key = `${r} on ${buildKey(pl)}`;
      if (!repeats.has(key)) repeats.set(key, new Set());
      repeats.get(key).add(pl.session);
    }
  }

  // Settled page lives only: the TypeScript arm sends no `attempt` row yet. A
  // stage whose settled sessions were all size-gated still gets its rows.
  const compared = (s) => s.lives.some((pl) => pl.settled) && !s.lives.some((pl) => pl.sizeGated);
  const steady = sessions.filter((s) => !s.changed && compared(s));
  const stages = [...new Set(sessions.filter((s) => !s.changed && COMPARED_ARMS.includes(s.arm) && s.lives.some((pl) => pl.settled)).map((s) => s.stage))].sort();
  const armRow = (inArm, stage, arm) => ({
    stage,
    arm,
    sessions: inArm.length,
    engaged: inArm.filter((s) => s.lives.some((pl) => pl.engaged)).length,
    faults: inArm.filter((s) => s.lives.some(engineFault)).length,
    crashes: inArm.filter((s) => crashSessions.has(s.id)).length,
  });
  // Sessions the size gate left out, by stage and arm: an asymmetric gate shows.
  const gatedOut = (stage, arm) => sessions.filter((s) => !s.changed && s.arm === arm && s.stage === stage && s.lives.some((pl) => pl.settled) && s.lives.some((pl) => pl.sizeGated)).length;
  const comparison = stages.map((stage) => {
    const [w, t] = COMPARED_ARMS.map((arm) => armRow(steady.filter((s) => s.arm === arm && s.stage === stage), stage, arm));
    w.sizeGatedOut = gatedOut(stage, "wasm");
    t.sizeGatedOut = gatedOut(stage, "ts");
    return { stage, wasm: w, ts: t, crashDifference: differenceInterval(w.crashes, w.sessions, t.crashes, t.sessions) };
  });
  const changed = armRow(sessions.filter((s) => s.changed && compared(s)), "any", "changed");
  const latchedSessions = new Set(pageLives.filter((pl) => pl.writerLatched).map((pl) => pl.session)).size;

  const eligible = (pl) => isEligible(pl, eligibleShas);
  const loading = (pl) => isEligible(pl, eligibleShas, true);
  const inTail = (pl) => tailShas.length > 0 && shaMatches(pl.sha, tailShas);
  // A same-session crash loop on an eligible commit, stage and arm.
  const loop = (pl) => suppressedFault(pl) && (pl.requested === ELIGIBLE_HOST || pl.requested === "ts") && pl.stage === ELIGIBLE_STAGE && pl.assignedArm === "wasm" && shaMatches(pl.sha, eligibleShas);
  const stopSignals = [
    ...[...repeats.entries()].filter(([, ids]) => ids.size >= 2).map(([key, ids]) => `engine fault ${code(key)} in ${plural(ids.size, "session")}`),
    ...(latchedSessions ? [`writer latch-off in ${plural(latchedSessions, "session")}`] : []),
    ...comparison.filter((c) => c.crashDifference && c.crashDifference[0] > 0).map((c) => `at stage ${code(c.stage)} the WASM arm's crash rate is above the TypeScript arm's (the 95% interval lies above zero)`),
  ];
  const attemptable = pageLives.filter((pl) => hosts.includes(pl.requested));

  return {
    attempts: { ...totals, rate: totals.sessions ? totals.faults / totals.sessions : null, upper95: upperBound(totals.faults, totals.sessions), upper95Pessimistic: upperBound(totals.faultsOrLeft, totals.sessions), byArm: [...attemptsByArm.values()].sort((a, b) => a.arm.localeCompare(b.arm)) },
    attemptsWithMovedOff: withMovedOff(totals),
    uncountedHostSessions,
    uncountedHostFaults,
    // Whether each compared arm's page lives are on a build that sends the
    // `engaged` row in that arm: the TypeScript arm may not.
    comparisonEngagedRows: Object.fromEntries(COMPARED_ARMS.map((arm) => [arm, buildCoverage(steady.filter((x) => x.arm === arm).flatMap((x) => x.lives.filter((pl) => pl.settled)), (pl) => pl.engaged)])),
    eligibleAttempts: cohort(sessions, loading, loading, loop, false),
    eligible: cohort(sessions, eligible, loading, loop),
    tailAttempts: cohort(sessions, (pl) => loading(pl) && inTail(pl), (pl) => loading(pl) && inTail(pl), (pl) => loop(pl) && inTail(pl), false),
    tail: cohort(sessions, (pl) => eligible(pl) && inTail(pl), (pl) => loading(pl) && inTail(pl), (pl) => loop(pl) && inTail(pl)),
    comparison,
    changed,
    crashSessions: crashSessions.size,
    unrecognizedSessions,
    attemptRows: buildCoverage(attemptable, (pl) => pl.attempted),
    // Once commits are named, only the page lives that could be eligible
    // decide whether the cohort's engagement is measured.
    engagedRows: buildCoverage(attemptable.filter((pl) => pl.settled && (!eligibleShas.length || loading(pl))), (pl) => pl.engaged),
    cohortFields: coverage(attemptable, (pl) => pl.stage !== "none" && pl.assignedArm !== "none"),
    stopSignals,
  };
}

const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(3)}%`);
const share = (k, n) => (n ? `${k} (${((k / n) * 100).toFixed(1)}%)` : `${k}`);

/** The caveats that must sit at the top of the report, above every figure.
 *  A row kind counts as measured only when every page life that could carry
 *  it is on a build that sends it; the cohort fields, only when every such
 *  page life carries them. */
export function cohortCaveats(c, meta) {
  const partial = (cov) => cov.of === 0 || cov.with < cov.of;
  const of = (cov) => `${cov.with} of ${cov.of} page lives`;
  const lines = [];
  if (!meta.eligibleShas.length) lines.push("> **No eligible commits named** (`--eligible-shas`), so nothing in this report is release evidence: every session is early telemetry.");
  if (partial(c.cohortFields)) lines.push(`> **The cohort fields are missing:** ${of(c.cohortFields)} that asked for the engine carry \`stage\` and \`assigned_arm\` (A4, #1197); the rest can never be eligible.`);
  if (partial(c.engagedRows)) lines.push(`> **Engagement is not fully measured:** ${of(c.engagedRows)} that settled on a counted host (on a named eligible commit, once commits are named) are on a build that sends an \`engaged\` row (the row waits for the owner's analytics approval), so the engaged cohort is empty or short because the row is missing, which says nothing about the engine.`);
  if (partial(c.attemptRows)) lines.push(`> **Early exits are partly invisible:** ${of(c.attemptRows)} on a counted host are on a build that sends an \`attempt\` row; a tab closed or crashed while the engine loaded on a build without it is in no count.`);
  return lines;
}

/** A by-build table under its own heading. */
const byBuildTable = (title, rows) => [
  "",
  `### ${title}`,
  "",
  "| Version (commit, bundle) | Sessions | Faults | 95% upper bound |",
  "| --- | --- | --- | --- |",
  ...rows.map((b) => `| ${code(b.build)} | ${b.sessions} | ${b.faults} | ${pct(b.upper95)} |`),
];

/** The cohorts' section of the report, as Markdown lines. */
export function renderCohortsMarkdown(c, meta) {
  const tailLabel = meta.tailShas.length ? meta.tailShas.map(code).join(", ") : "no commits named";
  const pop = (label, r) => `| ${label} | ${r.n ?? r.sessions} | ${r.faults} | ${pct(r.rate)} | ${pct(r.upper95)} | ${pct(r.upper95Pessimistic)} | ${r.latched} | ${share(r.leftBeforeTower, r.n ?? r.sessions)} |`;
  const conditional = "rate and bounds conditional on engagement";
  return [
    "",
    "## Release evidence and safety",
    "",
    "> The all-attempts denominator is the safety count: every engine fault in a page life that asked for a counted host is in it, before engagement too, and so is a crash loop a suppressed boot detected. `wasm`-arm sessions that never ran the engine (opted out to TypeScript or suppressed) are outside its N; the next row puts them in N as #1197 words it. The first reading departs from #1197's wording; which one the gate uses is pending the owner. A page life that left before a tower sits in N without a fault (some may be crashes during the load); the last column shows how many, and the pessimistic bound counts each as a fault, so the two bounds bracket the engine. A session with an override page life (a setting or the URL chose either engine, an opt-out included) is in no eligible row, since overridden sessions never qualify; its faults stay in all attempts. The engaged rows hold only sessions that engaged, so a fault that stopped a player engaging is outside them and inside the attempts rows: read the rows together. \`--shas\`, \`--versions\`, \`--builds\` and \`--arms\` apply only to the overall rate above; \`--hosts\` applies to both. Each session's arm is that of its first page life in the window that carries one. A page life still loading when this ran counts as having left before a tower, and one that left may have crashed while the engine loaded. Sessions are not independent, so each bound is optimistic.",
    "",
    "| Population | Sessions | Faults | Fault rate | 95% upper bound | 95% upper bound, early exits as faults | Latch-offs | Left before a tower |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    pop("All attempts (safety denominator)", c.attempts),
    pop("All attempts, moved-off `wasm`-arm sessions that never ran the engine in N (#1197's wording)", c.attemptsWithMovedOff),
    pop("Eligible attempts (engaged or not)", c.eligibleAttempts),
    pop(`Engaged eligible cohort (the 1,000-session gate's unit; ${conditional})`, c.eligible),
    pop(`Candidate tail attempts (${tailLabel}; engaged or not)`, c.tailAttempts),
    pop(`Candidate tail, engaged (${tailLabel}; ${conditional})`, c.tail),
    "",
    `Engaged by: command ${c.eligible.byEngagement.command}, 30 s of play ${c.eligible.byEngagement.play}, no route ${c.eligible.byEngagement.unknown}. Sessions with a page life carrying a value the game never sends (that page life is in no count; the session's others still count): ${c.unrecognizedSessions}. \`$exception\` sessions in the window: ${c.crashSessions}. Sessions with a page life on an uncounted WASM host and none counted here (widen \`--hosts\` to count them): ${c.uncountedHostSessions}, ${c.uncountedHostFaults} of them with an engine fault. Eligible attempts that did not engage: ${share(c.eligibleAttempts.byEngagement.none, c.eligibleAttempts.n)}. Sessions left out of the eligible rows for an override page life (with a fault the row would hold): ${c.eligibleAttempts.overridden} (${c.eligibleAttempts.overriddenFaults}) of the eligible attempts, ${c.eligible.overridden} (${c.eligible.overriddenFaults}) of the engaged cohort, ${c.tailAttempts.overridden} (${c.tailAttempts.overriddenFaults}) of the tail attempts.`,
    "",
    "Blind spots: a trap the host catches reports through `engine_status`, not `$exception`, so the crash comparison understates engine failures (the engine-fault column holds them); `$exception` is not split into engine and host code; a crash loop detected after a same-tab reload is charged to its session's cohorts when one of the session's page lives that crashed is in the window, but one detected in a new tab is a new session, so it cannot be charged to the session that crashed, and the cohort never sees it; a tab the browser kills after its first rows (out of memory, a hang) sends nothing more and reads clean unless a crash loop is detected; the comparison reads settled page lives only, so early exits are outside it in both arms, and since the load before a tower is mostly WASM-arm time, the WASM crash rate there reads low and the crash-difference signal fires late.",
    ...byBuildTable("Engaged eligible cohort by build", c.eligible.byBuild),
    ...byBuildTable("Candidate tail attempts by build", c.tailAttempts.byBuild),
    ...byBuildTable("Candidate tail, engaged, by build", c.tail.byBuild),
    "",
    "### All attempts by assigned arm",
    "",
    "| Arm | Sessions | Engaged on the engine | Did not engage | Faults | Faulted, never engaged | Left before a tower | Overrides other than opt-outs | Opted out or suppressed (any page life) | Of those, never ran the engine (outside the rate) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...c.attempts.byArm.map((r) => `| ${code(r.arm)} | ${r.sessions} | ${share(r.engaged, r.sessions)} | ${share(r.sessions - r.engaged, r.sessions)} | ${r.faults} | ${r.faultNotEngaged} | ${share(r.leftBeforeTower, r.sessions)} | ${r.overrides} | ${r.movedOff} | ${r.movedOffNeverRan} |`),
    "",
    "### Arm comparison by stage (overrides, opt-outs and suppressions included; sessions with a size-gated page life left out in both arms)",
    "",
    ...COMPARED_ARMS.filter((arm) => c.comparisonEngagedRows[arm].with < c.comparisonEngagedRows[arm].of).map((arm) => `Engagement in the ${code(arm)} arm is not measured: ${c.comparisonEngagedRows[arm].with} of ${c.comparisonEngagedRows[arm].of} settled page lives are on a build that sends the \`engaged\` row in that arm, so its Engaged column is short.`),
    "",
    "| Stage | Arm | Sessions | Engaged (any engine) | Engine-fault sessions | `$exception` sessions (any source) | Left out for the size gate |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...[...c.comparison.flatMap((s) => [s.wasm, s.ts]), c.changed].map((r) => `| ${code(r.stage)} | ${code(r.arm)} | ${r.sessions} | ${share(r.engaged, r.sessions)} | ${share(r.faults, r.sessions)} | ${share(r.crashes, r.sessions)} | ${r.sizeGatedOut ?? "n/a"} |`),
    "",
    ...c.comparison.map((s) => `Stage ${code(s.stage)} crash-rate difference, wasm minus ts, 95% interval: ${s.crashDifference ? `${pct(s.crashDifference[0])} to ${pct(s.crashDifference[1])}` : "n/a (an arm is empty)"}.`),
    "",
    "### Stop signals",
    "",
    ...(c.stopSignals.length ? c.stopSignals.map((s) => `- ${s}`) : ["- none of the evaluated signals"]),
    "- not evaluated: a repeated engine or host `$exception` (production stacks are minified and the rows carry no commit); triage it in PostHog error tracking",
  ];
}
