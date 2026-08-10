import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { ACTOR_NAMES } from "./actorNames";

/**
 * Guards the actor-name vocabulary that `engine.debug.filter` matches on (see
 * DEBUGGING.md). An unnamed actor can never match a `nameQuery`, so a missed
 * `name:` does not fail loudly: the filter just silently matches nothing, which
 * is indistinguishable from "there is nothing wrong here".
 *
 * Most of these actors are built inside `new ex.Canvas` / WebGL paths that
 * cannot run under happy-dom, so a behavioral test can only reach one of them
 * (`towerWalkerBuild.test.ts` asserts the real `walker` actor's name). This is
 * therefore a SOURCE-TEXT guard over the renderer: it cannot prove an actor is
 * named correctly at runtime, but it does catch the realistic regression, a
 * construction site added or refactored without a name. Both guards are kept:
 * one proves the mechanism works, this one proves it was applied everywhere.
 */

const RENDER_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

/** Every non-test source file in this directory. */
function renderSources(): { file: string; text: string }[] {
  return readdirSync(RENDER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "actorNames.ts")
    .map((file) => ({ file, text: readFileSync(join(RENDER_DIR, file), "utf8") }));
}

/** Actor/ScreenElement construction sites, as `{file, snippet}`. The snippet is
 *  the constructor's option object up to the first closing brace at the call's
 *  own indentation, which is enough to see whether `name:` is present. */
function constructionSites(): { file: string; snippet: string }[] {
  const sites: { file: string; snippet: string }[] = [];
  for (const { file, text } of renderSources()) {
    const re = /new ex\.(?:Actor|ScreenElement)\(\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Walk forward to the matching close brace so a multi-line options
      // object is captured whole (a fixed character window would truncate the
      // longer ones and report a false miss).
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        i++;
      }
      sites.push({ file, snippet: text.slice(m.index, i) });
    }
  }
  return sites;
}

describe("actor naming", () => {
  it("finds the construction sites it is meant to be guarding", () => {
    // A regex that silently matched nothing would make every assertion below
    // vacuous, which is the failure mode this whole file exists to prevent.
    expect(constructionSites().length).toBeGreaterThanOrEqual(20);
  });

  it("gives every actor and screen element a name", () => {
    // `name:` covers the literal form; the bare `name,` shorthand covers
    // `addBoxActor`, which takes the name as an `ActorName` parameter and
    // forwards it (rooms and transports share one constructor but not one name).
    const unnamed = constructionSites().filter((s) => !/\bname[:,]/.test(s.snippet));
    expect(unnamed.map((s) => `${s.file}: ${s.snippet.split("\n")[0].trim()}`)).toEqual([]);
  });

  it("names them only from the ACTOR_NAMES vocabulary", () => {
    // A bare string literal would work at runtime but leave DEBUGGING.md's
    // published list wrong, so the constant is the only allowed source. The
    // shorthand form is exempt: its parameter is typed `ActorName`, so the
    // compiler already refuses anything outside the vocabulary.
    const offenders = constructionSites().filter(
      (s) => /\bname:/.test(s.snippet) && !/\bname:\s*ACTOR_NAMES\./.test(s.snippet),
    );
    expect(offenders.map((s) => `${s.file}: ${s.snippet.split("\n")[0].trim()}`)).toEqual([]);
  });

  it("uses every name in the vocabulary, so none is dead", () => {
    // Scanned over whole files, not just constructor snippets: the names for
    // the shorthand sites appear at their CALLERS (`addBoxActor(engine,
    // ACTOR_NAMES.room, ...)`), which is outside the constructor's braces.
    const all = renderSources()
      .map((s) => s.text)
      .join("\n");
    const unused = Object.keys(ACTOR_NAMES).filter((key) => !all.includes(`ACTOR_NAMES.${key}`));
    expect(unused).toEqual([]);
  });

  it("keeps every value distinct, so a filter cannot mean two things", () => {
    const values = Object.values(ACTOR_NAMES);
    expect(new Set(values).size).toBe(values.length);
  });
});
