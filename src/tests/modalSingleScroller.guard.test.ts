import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Shift-left guard: ONE scroll container per dialog (GH #717).
 *
 * The Help dialog shipped with two vertical scrollbars, an outer one on the
 * `#modal` dialog element and an inner one on `.modal-box`. Nothing in this
 * repo added the outer one: current Chromium's UA stylesheet gives an open
 * `<dialog>` `overflow: auto`, so the moment a dialog's content passed the
 * box's 82vh cap, the dialog element became a second live scroller (and its
 * `.win` drop shadow got clipped, since the box fills the dialog exactly).
 * The same class of defect shipped once before on the schedule dialog
 * (GH #513, the `.es-grid` well), was fixed there alone, and came back here
 * because only that instance was patched. This guard pins the RULE instead:
 * `.modal-box` owns all of a dialog's vertical scrolling, and nothing else in
 * the dialog subtree may scroll vertically.
 *
 * Vitest runs in happy-dom, which does no layout, so "scrollable" cannot be
 * measured; like `stickyDialogActions.guard.test.ts`, this reads the CSS
 * facts the invariant depends on straight from the stylesheet source. The
 * dialog subtree is found data-driven: every class literal in the dialog
 * templates counts, so a NEW dialog body class that grows its own
 * `overflow-y: auto` fails here without this file naming it. A shared class
 * (.btn, .well) gaining a vertical scroller for some non-dialog surface would
 * also fail; that is deliberate strictness, and the right response is a
 * dialog-safe redesign or a consciously narrower selector, not loosening the
 * guard.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments carry braces and selector-shaped prose, so strip them first. */
function readCss(rel: string): string {
  return readFileSync(resolve(HERE, "..", rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/* The game page's whole cascade: styles.css plus the shared-chrome imports the
   dialog box actually wears (.win lives in retro-components). retro-page.css
   is standalone-page chrome and never loads in the game document. */
const SHEETS = [readCss("styles.css"), readCss("styles/retro-components.css"), readCss("styles/retro-tokens.css")];

interface Rule {
  selector: string;
  body: string;
  /** True when the rule sits inside any @-block (media, supports, ...). */
  conditional: boolean;
}

/** Flatten a stylesheet into rules, tagging those nested in @-blocks. One
 *  level of nesting is all this codebase writes; a deeper nesting would
 *  surface as a parse miss and fail the sanity check below. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  // Pull each top-level @-block out by brace counting, parse its contents as
  // conditional rules, and parse the remainder as base rules.
  let base = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@", i);
    if (at === -1) {
      base += css.slice(i);
      break;
    }
    base += css.slice(i, at);
    const open = css.indexOf("{", at);
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    for (const m of css.slice(open + 1, j - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      out.push({ selector: m[1].trim(), body: m[2], conditional: true });
    }
    i = j;
  }
  for (const m of base.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2], conditional: false });
  }
  return out;
}

const ALL_RULES = SHEETS.flatMap(rules);

/** Whether a declaration block leaves the element scrolling on the y axis.
 *  Handles the shorthand's one- and two-value forms and later declarations
 *  overriding earlier ones inside the same block. */
function scrollsVertically(body: string): boolean {
  let y: string | undefined;
  for (const m of body.matchAll(/(?:^|;)\s*overflow(-x|-y)?\s*:\s*([^;]+)/g)) {
    const axis = m[1] ?? "";
    const vals = m[2].trim().split(/\s+/);
    if (axis === "-y") y = vals[0];
    else if (axis === "") y = vals[1] ?? vals[0];
  }
  return y === "auto" || y === "scroll";
}

/** Every class literal the dialog templates render (plus the box shell classes
 *  UI.openModalTemplate stamps in code), as the dialog subtree's vocabulary.
 *  Interpolated class bindings cannot be read statically; every dialog's
 *  scaffolding classes are literals, which is what scrolling hangs on. */
function templateClassTokens(): Set<string> {
  const dir = resolve(HERE, "..", "ui", "templates");
  const tokens = new Set<string>(["modal-box", "win"]);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const src = readFileSync(resolve(dir, f), "utf8");
    for (const m of src.matchAll(/class="([^"$]+)"/g)) {
      for (const t of m[1].split(/\s+/)) {
        if (/^[A-Za-z_-][\w-]*$/.test(t)) tokens.add(t);
      }
    }
  }
  return tokens;
}

const TOKENS = templateClassTokens();

/** True when a selector can style the dialog subtree: it names `#modal`
 *  itself or any class the dialog templates render. */
function inDialogSubtree(selector: string): boolean {
  if (selector.includes("#modal")) return true;
  const classes = selector.match(/\.[A-Za-z_-][\w-]*/g) ?? [];
  return classes.some((c) => TOKENS.has(c.slice(1)));
}

describe("one scroll container per dialog", () => {
  it("parses the stylesheets and templates it guards (sanity)", () => {
    // A refactor that breaks the parsing (deeper @-nesting, renamed files)
    // must fail loudly here, not let the real assertions pass on empty sets.
    expect(ALL_RULES.length).toBeGreaterThan(100);
    expect(ALL_RULES.some((r) => r.conditional)).toBe(true);
    expect(TOKENS.has("help-modes")).toBe(true);
    expect(ALL_RULES.some((r) => !r.conditional && r.selector === ".modal-box" && scrollsVertically(r.body))).toBe(
      true,
    );
  });

  it("pins #modal to overflow: visible, because the UA default became auto", () => {
    // Deleting the declaration would pass any "does not scroll" scan of this
    // repo's CSS while the browser's own stylesheet brings the second
    // scrollbar back. The rule must state the override explicitly.
    const modal = ALL_RULES.filter((r) => r.selector === "#modal");
    expect(modal.length).toBeGreaterThan(0);
    expect(modal.some((r) => /overflow\s*:\s*visible/.test(r.body))).toBe(true);
  });

  it("never turns #modal into a scroller, in any rule or media block", () => {
    for (const r of ALL_RULES) {
      if (r.selector.includes("#modal")) {
        expect(scrollsVertically(r.body), `#modal must not scroll: \`${r.selector}\``).toBe(false);
      }
    }
  });

  it("gives the dialog subtree exactly one vertical scroller: .modal-box", () => {
    // The #513 and #717 regressions were both a SECOND live vertical scroll
    // container inside an already-scrolling dialog. Whatever else a dialog
    // needs, its base cascade may scroll exactly one element.
    const scrollers = ALL_RULES.filter((r) => !r.conditional && inDialogSubtree(r.selector) && scrollsVertically(r.body));
    expect(scrollers.map((r) => r.selector)).toEqual([".modal-box"]);
  });

  it("lets media blocks re-scroll only the ratified schedule-grid well", () => {
    // Small screens and coarse pointers deliberately restore the .es-grid
    // 200px well (#513): overlay scrollbars are invisible there and the cap
    // keeps the steppers and OK button within a swipe. That is the ONLY
    // sanctioned second scroller, and only under a condition.
    const scrollers = ALL_RULES.filter((r) => r.conditional && inDialogSubtree(r.selector) && scrollsVertically(r.body));
    expect(scrollers.length).toBeGreaterThan(0);
    for (const r of scrollers) {
      expect(r.selector, "only .es-grid may scroll under a media condition").toBe(".es-grid");
    }
  });
});
