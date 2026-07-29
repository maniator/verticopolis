import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Shift-left guard for the pinned dialog action strip.
 *
 * The unit tests around the schedule dialog run in a DOM with no layout and no
 * stylesheet, so they can prove the unsaved-changes warning EXISTS and sits in
 * the action strip, but not that the strip is on screen. That gap is exactly
 * how the original bug shipped: the dirty guard worked perfectly and its whole
 * feedback rendered where the player could not see it. Without something
 * reading the stylesheet, deleting `position: sticky` would break the fix and
 * fail nothing.
 *
 * So this asserts the CSS facts the fix depends on, in the same spirit as
 * `a11ySweep541.guard.test.ts`. It is deliberately about the RULE, not about
 * pixels; the gallery's mid-scroll shots carry the visual proof.
 */
const RAW = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"),
  "utf8",
);
/** Comments carry braces and selector-shaped prose, so strip them first. */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The declaration block for a selector that starts a line. Throws when the
 * selector is absent rather than returning "", because an empty string makes
 * every `not.toMatch` below pass for the wrong reason.
 */
function block(selector: string): string {
  const at = CSS.indexOf("\n" + selector + " {");
  if (at === -1) throw new Error(`no rule in styles.css for \`${selector}\``);
  return CSS.slice(at, CSS.indexOf("}", at));
}

/** `.win`'s inset bevel occupies this many pixels inside the padding box. */
const BEVEL_PX = 2;

const STRIP_SELECTOR =
  ".modal-box > .modal-actions:last-child,\n.modal-box > .modal-actions:nth-last-child(2)";
/** The downward cover, which only a true last child is allowed to paint. */
const DOWN_SELECTOR = ".modal-box > .modal-actions:last-child";

/**
 * Every `--pad-y` the stylesheet sets ON `.modal-box`, not just the first: a
 * media query or theme block redefining it would move the real padding while a
 * single-rule lookup kept comparing against the base value and passing. Scoped
 * to `.modal-box` because other surfaces (the inspector, the editor card) carry
 * their own `--pad-y` and no pinned footer.
 */
function padY(): number {
  const found = new Set(
    [...CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter(([, sel]) => /\.modal-box\b/.test(sel))
      .map(([, , body]) => /--pad-y:\s*(\d+)px/.exec(body)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number),
  );
  if (found.size !== 1) throw new Error(`.modal-box sets ${found.size} different --pad-y values: ${[...found]}`);
  return [...found][0];
}

/** Every rule in the file that pins something, as [selector, declarations]. */
const stickyRules: Array<[string, string]> = [
  ...CSS.matchAll(/([^{}]*)\{([^{}]*position:\s*sticky[^{}]*)\}/g),
].map((m) => [m[1].trim(), m[2]]);

describe("pinned dialog action strip", () => {
  const strip = block(STRIP_SELECTOR);

  it("pins the trailing action strip to the bottom of the scrolling box", () => {
    expect(strip).toMatch(/position:\s*sticky/);
    expect(strip).toMatch(/bottom:\s*0/);
  });

  it("targets the dialog FOOTER only, never a mid-body action row", () => {
    // Tower Statistics renders a .modal-actions mid-body for the exterminator;
    // pinning that would park a button on an opaque band over the sections the
    // player is scrolling past. Settings renders its version line AFTER the
    // actions, so :last-child alone would skip the dialog most likely to
    // scroll on a phone. Both arms are required.
    //
    // Read off the stylesheet rather than off the selector this test looked
    // the rule up by, which would only restate itself: EVERY sticky rule that
    // mentions .modal-actions has to be this one, so a later `.modal-actions
    // { position: sticky }` or a descendant-combinator variant fails here.
    const pinned = stickyRules.filter(([sel]) => sel.includes(".modal-actions"));
    expect(pinned.map(([sel]) => sel)).toEqual([STRIP_SELECTOR]);
  });

  it("redraws the dialog's bevel on top of the downward cover", () => {
    // The cover runs the full padding band, so it paints over `.win`'s inset
    // bevel (a descendant always paints over a parent's inset shadow). Rather
    // than stop short and leave text sliced in the bevel's 2px, the rule
    // repaints those 2px in the bevel's own colors, outermost last.
    const parts = (/box-shadow:([^;]*)/.exec(block(DOWN_SELECTOR))?.[1] ?? "").split(",").map((p) => p.trim());
    const pad = padY();
    expect(parts).toContain(`0 ${pad - BEVEL_PX}px 0 var(--panel)`);
    expect(parts).toContain(`0 ${pad - 1}px 0 var(--r-shadow)`);
    expect(parts).toContain(`0 ${pad}px 0 var(--r-dark)`);
    // Outermost paints last, so the bevel's own colors must appear in the same
    // order the token file lists them for the bottom edge.
    expect(parts.indexOf(`0 ${pad - 1}px 0 var(--r-shadow)`)).toBeLessThan(
      parts.indexOf(`0 ${pad}px 0 var(--r-dark)`),
    );
    const tokens = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "styles", "retro-tokens.css"),
      "utf8",
    );
    const bevel = /--bevel-out:([^;]*)/.exec(tokens)?.[1] ?? "";
    expect(bevel).toContain(`inset -1px -1px var(--r-dark)`);
    expect(bevel).toContain(`inset -${BEVEL_PX}px -${BEVEL_PX}px var(--r-shadow)`);
  });

  it("covers the gap BELOW itself, out to the padding edge", () => {
    // A sticky `bottom: 0` stops at the scroll container's bottom padding, not
    // at its visible edge, so the strip parks `--pad-y` above the bottom and
    // that band is a live window onto content that has not scrolled past yet.
    // On a Pixel 8a the schedule dialog showed two lines of the Simulate
    // readout under the buttons, sliced through the middle. Anything short of
    // the full padding leaves a thinner version of that same defect.
    const offsets = [...block(DOWN_SELECTOR).matchAll(/0 (\d+)px 0 var\(/g)].map((m) => Number(m[1]));
    expect(Math.max(...offsets)).toBe(padY());
  });

  it("never paints downward when the dialog has trailing content", () => {
    // The downward cover assumes the space under the strip is the container's
    // padding. That holds only for a true last child. Settings renders its
    // build-id line AFTER the action row, and covering downward there painted
    // the redrawn bevel across the dialog as a heavy double rule above that
    // line, on a dialog that does not scroll at all. Lifting the trailing
    // element above the cover does NOT fix it: its own box is transparent, so
    // the lines still show around its text. The shared rule stays upward-only,
    // and the downward cover lives on its own `:last-child` rule.
    const shared = block(STRIP_SELECTOR);
    expect([...shared.matchAll(/0 (\d+)px 0 var\(/g)].map((m) => Number(m[1]))).toEqual([]);
    expect(shared).toMatch(/box-shadow:\s*0 -12px 0 var\(--panel\)/);
    // And nothing may lift a following sibling to work around the above.
    expect(CSS).not.toMatch(/nth-last-child\(2\) ~ \*/);
  });

  it("adds no box of its own, so no dialog gets taller", () => {
    // An earlier cut added plain padding and shifted every dialog in the app.
    // The cut after it swapped the row's margin-top for equal padding-top and
    // read as neutral, but is not: margins COLLAPSE with the preceding
    // sibling's margin-bottom and padding does not, so it silently added that
    // sibling's margin back (6px under a paragraph, 8px under a Settings row)
    // to eight dialogs. Only paint is safe here, and a box-shadow is paint.
    expect(strip).not.toMatch(/[;{]\s*(padding|margin|border|min-height)/);
    expect(strip).toMatch(/box-shadow:\s*0 -\d+px 0 var\(--panel\)/);
  });

  it("covers exactly the gap the row's own margin opens, and no more", () => {
    // The shadow is the only thing hiding scrolled content in that gap, and it
    // must not reach past it onto the paragraph above. Both numbers move
    // together or the strip either leaks or overpaints.
    const gap = /margin-top:\s*(\d+)px/.exec(block(".modal-actions"))?.[1];
    const cover = /box-shadow:\s*0 -(\d+)px 0/.exec(strip)?.[1];
    expect(gap).toBeDefined();
    expect(cover).toBe(gap);
  });

  it("stays INSIDE the padding box, so the dialog keeps its bevel", () => {
    // `.modal-box` is `.win`, whose bevel is an INSET box-shadow, and a child's
    // background paints over a parent's inset shadow. Full-bleed negative
    // margins pushed this strip out to the box's border box and flattened the
    // Win3.1 edge on every dialog. The cover shadow is offset vertically only,
    // with no spread, so it is exactly as wide as the strip.
    expect(strip).not.toMatch(/margin-(left|right|inline)/);
    // Every shadow in the rule must be offset-only: two lengths then the color.
    // Checking for "four lengths" missed the form this file actually writes,
    // where zeros are bare (`0 18px 0 4px`), so a real spread slipped through.
    const shadows = /box-shadow:([^;]*)/.exec(strip)?.[1] ?? "";
    expect(shadows).not.toBe("");
    for (const part of shadows.split(",")) {
      // Offset-x, offset-y, a zero blur, and a token color. No spread: a spread
      // would widen the cover past the strip and back over the box's bevel at
      // the sides, which is the full-bleed regression in another form.
      expect(part.trim()).toMatch(/^-?\d+(px)? -?\d+(px)? 0 var\(--[a-z-]+\)$/);
    }
  });

  it("paints an opaque background so scrolled content cannot show through", () => {
    expect(strip).toMatch(/background:\s*var\(--panel\)/);
  });

  it("layers under the sticky title bar rather than over it", () => {
    expect(strip).toMatch(/z-index:\s*1\b/);
    expect(block(".modal-box > .win-title")).toMatch(/z-index:\s*2\b/);
  });

  it("uses no scoped custom property for the offset, which would fail silently", () => {
    // An unresolved `--pad-y` drops `bottom` to `auto`: the strip never sticks,
    // with no warning anywhere. A literal 0 cannot fail that way.
    expect(strip).not.toMatch(/var\(--pad-/);
  });

  it("styles the unsaved-changes warning as the strip's leading text", () => {
    const warn = block(".modal-warn");
    expect(warn).toMatch(/margin-right:\s*auto/);
    // align-self, NOT align-items: the latter would re-align every other
    // dialog's buttons, so the block that must stay clear of it is the SHARED
    // `.modal-actions` rule. Asserting it against the pinned block instead
    // guarded the one place the property would have been harmless.
    expect(warn).toMatch(/align-self:\s*center/);
    expect(block(".modal-actions")).not.toMatch(/align-items:/);
  });
});
