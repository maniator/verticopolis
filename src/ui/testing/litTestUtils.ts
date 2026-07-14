import { render, type TemplateResult } from "lit-html";

/**
 * Unit-tier test harness for lit templates (see the plan of record,
 * `_bmad-output/planning-artifacts/design/ui-rendering-engine-2026-07-14/`).
 * Every template is proven at the unit tier, in happy-dom, before the slower
 * behavioral and visual tiers run. Two kinds of helpers live here:
 *
 *  - `renderToFragment` renders a `TemplateResult` into detached nodes so a unit
 *    test can read its structure without a live modal or the app.
 *  - `dispatch`/`click`/`change`/`input` fire events on a rendered node so a test
 *    can assert an inline `@click`/`@change` binding called back correctly.
 *
 * The transitional `assertDomEquivalent` guard, which proved each lit template
 * matched the legacy HTML string it replaced, retired with the string builders
 * in the final migration sweep (git history keeps it).
 *
 * This module is test-only infrastructure: it is imported by `*.test.ts` files,
 * never by app code, so it is tree-shaken out of the production bundle.
 */

/** Render a lit template into a detached container and hand back its nodes as a
 *  fragment. lit brackets its bindings with boundary comment markers; those are
 *  stripped here so the fragment's child list matches the template's authored
 *  structure. The template is rendered once (this harness never re-renders). */
export function renderToFragment(result: TemplateResult): DocumentFragment {
  const container = document.createElement("div");
  render(result, container);
  const frag = document.createDocumentFragment();
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 8 /* Comment: lit part markers */) continue;
    frag.appendChild(node);
  }
  return frag;
}

/** Fire a bubbling, cancelable event on a rendered node so a test can prove an
 *  inline `@click`/`@change`/`@input` binding called back. It is a plain `Event`
 *  (no mouse/input fields); a test that needs `event.target.value` sets the
 *  node's `value` before calling `change`/`input`. */
export function dispatch(node: Element, type: string, init: EventInit = {}): void {
  node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
}

export const click = (node: Element): void => dispatch(node, "click");
export const change = (node: Element): void => dispatch(node, "change");
export const input = (node: Element): void => dispatch(node, "input");
