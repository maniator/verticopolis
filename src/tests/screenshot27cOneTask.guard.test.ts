import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Shift-left guard for the 27c screenshot determinism fix (#762, #843).
 *
 * 27c's dialog shrinks by a fraction of a pixel when the scene edits it, and
 * its composited sticky layers keep the subpixel phase of their first raster.
 * The fix stages the open, the edit, the Esc and the scroll inside ONE
 * `page.evaluate` callback, so no frame can render between them. Split those
 * steps across round trips again and the capture is a race: measured on main,
 * 7 of 20 two-leg determinism runs failed. The runner's phase watch is a
 * tripwire that only fires on the runs where the race goes the bad way, so
 * this pins the structure itself, in milliseconds, on every `npm test`.
 *
 * It reads the scene source rather than running it: the staging only means
 * anything in a real browser, and the property at stake (one task, no yield)
 * is a fact about the code's shape.
 */
const SCENE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "scenes", "schedule.ts");

/** Source with comments removed, so prose about the steps cannot satisfy or
 *  trip the checks. */
function stripComments(src: string): string {
  // Block comments, whole-line comments, and trailing ones after code (a
  // `//` preceded by whitespace; the scene has no such text inside strings).
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
}

/** indexOf that fails loudly: a missing anchor means the scene changed shape,
 *  and slicing on -1 would quietly widen what the checks read. */
function find(src: string, needle: string, from = 0): number {
  const at = src.indexOf(needle, from);
  if (at < 0) throw new Error(`the 27c guard lost its anchor ${JSON.stringify(needle)}; update the guard with the scene`);
  return at;
}

/** Everything a staged 27c open must do, in order, inside one callback. */
const STEPS: { name: string; pattern: RegExp }[] = [
  { name: "the Schedule button click", pattern: /\bopen\.click\(\)/ },
  { name: "the preset click", pattern: /\bpreset\.click\(\)/ },
  { name: "the Esc (cancel) dispatch", pattern: /new Event\("cancel"/ },
  { name: "the mid-dialog scroll", pattern: /\.scrollTop\s*=/ },
];

/** Anything inside the callback that yields to the event loop, which would
 *  let a frame render between the steps. */
const YIELDS =
  /\bawait\b|requestAnimationFrame|requestIdleCallback|setTimeout|setInterval|queueMicrotask|new Promise|\.then\(|addEventListener|Observer\(|MessageChannel|scheduler\./;

/** Problems with the staged open in a scene source; empty when the staging is
 *  one task. Takes the source as a string so the self-tests below can feed it
 *  the pre-fix shape. */
function stagingProblems(source: string): string[] {
  const src = stripComments(source);
  const problems: string[] = [];
  const fnStart = src.indexOf("async function openScheduleDialog(");
  if (fnStart < 0) return ["openScheduleDialog is gone"];
  const fnEnd = src.indexOf("\n}\n", fnStart);
  if (fnEnd < 0) return ["openScheduleDialog has no closing brace on its own line"];
  const fn = src.slice(fnStart, fnEnd);
  // The callbacks handed to page.evaluate, in order.
  const callbacks = fn.split(/page\.evaluate\(/).slice(1);
  const staging = callbacks.find((cb) => STEPS.some((s) => s.pattern.test(cb)));
  if (!staging) return ["no page.evaluate callback stages the dialog"];
  // The callback ends where its argument object begins (`{ k: kind, ... }`).
  const end = staging.search(/\},\s*\{\s*k:\s*kind/);
  if (end < 0) return ["the staging callback's argument object ({ k: kind, ... }) is gone, so its end cannot be found"];
  const body = staging.slice(0, end);
  let at = -1;
  for (const step of STEPS) {
    const m = step.pattern.exec(body);
    if (!m) {
      problems.push(`${step.name} is not in the staging callback`);
      continue;
    }
    if (m.index < at) problems.push(`${step.name} runs out of order`);
    at = m.index;
  }
  const y = YIELDS.exec(body);
  if (y) problems.push(`the staging callback yields (${y[0]}), so a frame can render between the steps`);
  return problems;
}

describe("27c screenshot staging (#762, #843)", () => {
  const scene = readFileSync(SCENE, "utf8");

  it("opens, edits, arms and scrolls the dialog in one page task", () => {
    expect(stagingProblems(scene)).toEqual([]);
  });

  it("27c uses the staged path and keeps the phase watch on", () => {
    const src = stripComments(scene);
    const at = find(src, 'name: "27c-elevator-schedule-unsaved"');
    // The shot's own `wait:` sits at the shot's property indent.
    const shot = src.slice(at, find(src, "\n        wait:", at));
    expect(shot).toMatch(/phaseWatch:\s*true/);
    expect(shot).toMatch(/openScheduleDialog\(page,\s*"elevatorStandard",\s*true\)/);
    // Nothing else in its setup touches the page, directly or through a
    // helper: `page` appears exactly twice, as the setup's `(page)` parameter
    // and as the staged call's argument. Any extra round trip before the
    // capture is where a split would sneak back in.
    expect(shot.match(/\bpage\b/g)?.length).toBe(2);
  });

  it("rejects the split staging main shipped before the fix", () => {
    // The pre-fix shape, reduced: open in one evaluate, edit and Esc in later
    // round trips, so a frame could render between them.
    const split = `
async function openScheduleDialog(page, kind) {
  await page.evaluate((k) => { open.click(); }, kind);
  await page.evaluate(() => { preset.click(); });
  await page.evaluate(() => { dlg.dispatchEvent(new Event("cancel", { cancelable: true })); });
  await page.evaluate(() => { box.scrollTop = 10; });
}
`;
    expect(stagingProblems(split)).not.toEqual([]);
  });

  it("rejects a step deferred to a listener inside the staging callback", () => {
    const deferred = scene.replace(/(\n\s*)(box\.scrollTop\s*=)/, '$1window.addEventListener("resize", () => {});$1$2');
    expect(deferred).not.toBe(scene);
    expect(stagingProblems(deferred).join(" ")).toMatch(/yields/);
  });

  it("rejects an extra round trip in 27c's setup, even through a helper", () => {
    const extra = scene.replace(
      /(openScheduleDialog\(page, "elevatorStandard", true\);)/,
      "$1\n          await settleAgain(page);",
    );
    expect(extra).not.toBe(scene);
    const src = stripComments(extra);
    const at = find(src, 'name: "27c-elevator-schedule-unsaved"');
    const shot = src.slice(at, find(src, "\n        wait:", at));
    expect(shot.match(/\bpage\b/g)?.length).not.toBe(2);
  });

  it("rejects a staging callback that waits for a frame between the steps", () => {
    const yielding = scene.replace(/(\n\s*preset\.click\(\);)/, "\n      await new Promise((r) => requestAnimationFrame(r));$1");
    expect(yielding).not.toBe(scene);
    expect(stagingProblems(yielding).join(" ")).toMatch(/yields/);
  });
});
