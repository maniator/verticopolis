// Shared page-life fixtures for the #1090 cohort tests.
import { summarizeCohorts } from "../scripts/engine-reliability-cohorts.mjs";
import type { PageLife } from "../scripts/engine-reliability.mjs";

export const SHA = "abc1234";

/** An eligible, engaged, clean stage-3 page life; override what a case needs. */
export function life(over: Partial<PageLife> = {}): PageLife {
  return {
    session: "s1",
    pageLife: `p-${Math.random()}`,
    version: "2.50.0",
    sha: SHA,
    build: "switchable",
    requested: "wasm",
    stage: "3",
    assignedArm: "wasm",
    selectedBy: "cohort",
    safetySuppressed: false,
    sizeGated: false,
    fallbacks: 0,
    settleFallbacks: 0,
    reasons: [],
    writerLatched: false,
    settled: true,
    attempted: true,
    engaged: true,
    engagedEngine: "wasm",
    engagedBy: "command",
    firstSeen: "2026-12-01 12:00:00",
    ...over,
  };
}

export const fault = { fallbacks: 1, reasons: ["trap-tick"] };
export const run = (lives: PageLife[], over: { eligibleShas?: string[]; tailShas?: string[]; crashSessions?: Set<string> } = {}) =>
  summarizeCohorts(lives, { hosts: ["wasm"], eligibleShas: [SHA], ...over });
