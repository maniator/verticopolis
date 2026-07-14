import { render, type TemplateResult } from "lit-html";

/**
 * Shift-left test harness for the lit-html migration (see the plan of record,
 * `_bmad-output/planning-artifacts/design/ui-rendering-engine-2026-07-14/`).
 * Every migrated template is proven at the unit tier, in happy-dom, before the
 * slower behavioral and visual tiers run. Three helpers live here:
 *
 *  - `renderToFragment` renders a `TemplateResult` into detached nodes so a unit
 *    test can read its structure without a live modal or the app.
 *  - `assertDomEquivalent` is the transitional regression guard: it proves a lit
 *    template emits the SAME structure as the legacy HTML string it replaces,
 *    comparing normalized DOM (never raw `outerHTML`), so it catches the drift
 *    the pixel snapshot is blind to (a dropped/changed attribute, a
 *    property-vs-attribute swap, a reflowed inline space).
 *  - `dispatch`/`click`/`change`/`input` fire events on a rendered node so a test
 *    can assert an inline `@click`/`@change` binding called back correctly.
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

// Block-level tags: whitespace that only separates two block siblings is layout-
// insignificant and ignored. Whitespace between two inline elements (a button,
// span, anchor) can change spacing, so it is significant and compared. Whitespace
// adjacent to text is part of that text run and is always compared.
const BLOCK_TAGS = new Set([
  "html", "body", "div", "p", "section", "article", "header", "footer", "nav",
  "main", "aside", "form", "fieldset", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "figure", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "pre", "blockquote", "dialog",
  "details", "summary",
]);

// Boolean attributes compared by PRESENCE (value ignored), so `disabled` and
// `disabled=""` read the same. `checked`/`selected`/`value` are NOT compared as
// attributes: lit's `?checked=`/`.value=` bindings set the live property without
// necessarily writing the attribute, so those are compared as live state below.
const BOOLEAN_ATTRS = new Set(["disabled", "hidden", "required", "readonly", "multiple", "autofocus"]);
// Attributes handled specially and skipped from the generic map: `class` (as a
// sorted token set) and the form-state trio (as live properties).
const SKIP_ATTRS = new Set(["class", "value", "checked", "selected"]);
const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);

function isBlock(el: Element | null): boolean {
  return el != null && BLOCK_TAGS.has(el.tagName.toLowerCase());
}

/** A normalized token stream for one element's children: elements in order, plus
 *  text runs (adjacent text nodes coalesced, whitespace collapsed to single
 *  spaces). lit splits an interpolation adjacent to static text into several
 *  text nodes bracketed by comment markers, so coalescing is what lets the lit
 *  output match the single text node the legacy string parses to. Whitespace-only
 *  runs are tagged so the comparator can drop the ones that merely separate block
 *  siblings while keeping the ones that space inline elements apart. */
type Token =
  | { kind: "el"; el: Element }
  | { kind: "text"; text: string }
  | { kind: "ws" };

function tokenize(parent: Node): Token[] {
  const out: Token[] = [];
  let run = "";
  const flush = (): void => {
    if (run === "") return;
    const collapsed = run.replace(/\s+/g, " ");
    out.push(collapsed.trim() === "" ? { kind: "ws" } : { kind: "text", text: collapsed });
    run = "";
  };
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 8 /* Comment: lit markers, ignored on both sides */) continue;
    if (node.nodeType === 3 /* Text */) {
      run += node.textContent ?? "";
      continue;
    }
    if (node.nodeType === 1 /* Element */) {
      flush();
      out.push({ kind: "el", el: node as Element });
    }
    // Other node types (CDATA/PI/doctype) do not occur in the dialog markup.
  }
  flush();
  return out;
}

/** Drop whitespace-only runs that only separate block-level siblings; keep the
 *  ones strictly between two inline elements (those affect layout and must
 *  match). A whitespace-only run can only sit between two elements, since
 *  whitespace adjacent to text is coalesced into that text run above. */
function significantTokens(tokens: Token[]): Token[] {
  return tokens.filter((tok, i) => {
    if (tok.kind !== "ws") return true;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const prevEl = prev?.kind === "el" ? prev.el : null;
    const nextEl = next?.kind === "el" ? next.el : null;
    return prevEl != null && nextEl != null && !isBlock(prevEl) && !isBlock(nextEl);
  });
}

/** A canonical, order-independent signature of an element's identity: its tag,
 *  its sorted unique class set, every other attribute (value attributes exact,
 *  boolean attributes by presence), and the live form-state (`value`/`checked`/
 *  `selected`) that a lit property binding may set without an attribute. Values
 *  are JSON-encoded so a comma or space inside one can never collide with the
 *  delimiters. */
function signature(el: Element): string {
  const attrs: Record<string, string | boolean> = {};
  for (const name of el.getAttributeNames()) {
    if (SKIP_ATTRS.has(name)) continue;
    attrs[name] = BOOLEAN_ATTRS.has(name) ? true : (el.getAttribute(name) ?? "");
  }
  const classes = [...new Set((el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean))].sort();
  const live: Record<string, unknown> = {};
  const asAny = el as unknown as { value?: unknown; checked?: unknown; selected?: unknown };
  if (FORM_TAGS.has(el.tagName) && typeof asAny.value === "string") live.value = asAny.value;
  if (el.tagName === "INPUT" && typeof asAny.checked === "boolean") live.checked = asAny.checked;
  if (el.tagName === "OPTION" && typeof asAny.selected === "boolean") live.selected = asAny.selected;
  const attrStr = Object.keys(attrs).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(attrs[k])}`).join(",");
  const liveStr = Object.keys(live).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(live[k])}`).join(",");
  return `classes=${JSON.stringify(classes)}|attrs={${attrStr}}|live={${liveStr}}`;
}

function compareNodes(a: Element, b: Element, path: string): void {
  const ta = a.tagName.toLowerCase();
  const tb = b.tagName.toLowerCase();
  if (ta !== tb) throw new Error(`DOM mismatch at ${path}: tag <${ta}> vs <${tb}>`);
  const sa = signature(a);
  const sb = signature(b);
  if (sa !== sb) throw new Error(`DOM mismatch at ${path} <${ta}>: attributes\n  legacy: ${sa}\n  lit:    ${sb}`);
  compareChildren(a, b, path);
}

function compareChildren(a: Node, b: Node, path: string): void {
  const at = significantTokens(tokenize(a));
  const bt = significantTokens(tokenize(b));
  if (at.length !== bt.length) {
    throw new Error(`DOM mismatch at ${path}: child count ${at.length} vs ${bt.length}`);
  }
  let elIndex = 0;
  for (let i = 0; i < at.length; i++) {
    const x = at[i];
    const y = bt[i];
    if (x.kind !== y.kind) throw new Error(`DOM mismatch at ${path}[${i}]: node kind ${x.kind} vs ${y.kind}`);
    if (x.kind === "el" && y.kind === "el") {
      const tag = x.el.tagName.toLowerCase();
      compareNodes(x.el, y.el, `${path} > ${tag}[${elIndex++}]`);
    } else if (x.kind === "text" && y.kind === "text") {
      if (x.text !== y.text) throw new Error(`DOM mismatch at ${path}[${i}]: text "${x.text}" vs "${y.text}"`);
    }
    // Two `ws` tokens agree on presence; a single collapsed space is the only
    // significant-whitespace value, so there is nothing more to compare.
  }
}

/**
 * Assert that a lit template renders the SAME structure as the legacy HTML
 * string it replaces. Compares a normalized DOM tree, NEVER raw `outerHTML`: the
 * tag tree, each element's sorted `class` set, every other attribute (exact
 * value, booleans by presence), and live form-state (`value`/`checked`/
 * `selected`). Whitespace that only separates block siblings is ignored;
 * whitespace between inline elements and whitespace adjacent to text are
 * preserved and compared. Comments (including lit's markers) are ignored on both
 * sides. Throws a descriptive error on the first divergence.
 */
export function assertDomEquivalent(legacyString: string, litTemplate: TemplateResult): void {
  const legacy = document.createElement("template");
  legacy.innerHTML = legacyString;
  const litContainer = document.createElement("div");
  render(litTemplate, litContainer);
  compareChildren(legacy.content, litContainer, "root");
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
