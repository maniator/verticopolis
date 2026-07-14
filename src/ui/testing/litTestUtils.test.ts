import { describe, it, expect, vi } from "vitest";
import { html } from "lit-html";
import { renderToFragment, assertDomEquivalent, dispatch, click, change, input } from "./litTestUtils";

/**
 * Unit tests for the shift-left harness itself, so every later story can trust
 * it. `renderToFragment` yields readable nodes (no lit markers); `assertDomEquivalent`
 * passes on behavior-neutral differences (class/attribute order, block whitespace,
 * an interpolation adjacent to static text) and fails on the drift the pixel
 * snapshot is blind to (dropped/changed attribute, changed tag/text, a reflowed
 * inline space, a live form-state difference); the event helpers fire real events.
 */

describe("renderToFragment", () => {
  it("renders a template into detached, queryable nodes", () => {
    const frag = renderToFragment(html`<div class="box"><button data-act="go">Go</button></div>`);
    expect(frag.querySelector(".box")).not.toBeNull();
    expect(frag.querySelector('[data-act="go"]')?.textContent).toBe("Go");
  });

  it("interpolates dynamic text", () => {
    const frag = renderToFragment(html`<p>${"hello"}</p>`);
    expect(frag.querySelector("p")?.textContent).toBe("hello");
  });

  it("strips lit boundary comment markers so the child list matches the authored structure", () => {
    const frag = renderToFragment(html`<h2>${"T"}</h2><p>${"B"}</p>`);
    const comments = Array.from(frag.childNodes).filter((n) => n.nodeType === 8);
    expect(comments).toHaveLength(0);
    expect(Array.from(frag.childNodes).map((n) => n.nodeName.toLowerCase())).toEqual(["h2", "p"]);
  });
});

describe("assertDomEquivalent passes on behavior-neutral differences", () => {
  it("identical structure", () => {
    expect(() => assertDomEquivalent(`<h2>T</h2><p>B</p>`, html`<h2>T</h2><p>B</p>`)).not.toThrow();
  });

  it("class token order does not matter", () => {
    expect(() =>
      assertDomEquivalent(`<button class="btn primary"></button>`, html`<button class="primary btn"></button>`),
    ).not.toThrow();
  });

  it("duplicate class tokens normalize away", () => {
    expect(() =>
      assertDomEquivalent(`<button class="btn btn"></button>`, html`<button class="btn"></button>`),
    ).not.toThrow();
  });

  it("attribute order does not matter", () => {
    expect(() =>
      assertDomEquivalent(`<button data-act="yes" class="btn"></button>`, html`<button class="btn" data-act="yes"></button>`),
    ).not.toThrow();
  });

  it("whitespace between block elements is ignored", () => {
    expect(() => assertDomEquivalent(`<div>a</div>\n       <div>b</div>`, html`<div>a</div><div>b</div>`)).not.toThrow();
  });

  it("a significant space between two inline elements is preserved when present on both sides", () => {
    expect(() =>
      assertDomEquivalent(`<span>a</span> <span>b</span>`, html`<span>a</span> <span>b</span>`),
    ).not.toThrow();
  });

  it("an interpolation adjacent to static text coalesces (no false child-count mismatch)", () => {
    // lit splits `Hello ${x}!` into three text nodes bracketed by comment markers;
    // the legacy string is one. Coalescing is what makes them equivalent.
    expect(() => assertDomEquivalent(`<h2>Hello Bob!</h2>`, html`<h2>Hello ${"Bob"}!</h2>`)).not.toThrow();
  });

  it("an inline @click binding is invisible (not a real attribute)", () => {
    expect(() =>
      assertDomEquivalent(`<button data-act="go">Go</button>`, html`<button data-act="go" @click=${() => {}}>Go</button>`),
    ).not.toThrow();
  });

  it("a boolean attribute matches whether authored bare or empty-valued", () => {
    expect(() => assertDomEquivalent(`<input disabled />`, html`<input disabled="" />`)).not.toThrow();
  });

  it("a non-enumerated attribute (href, title) matches when equal", () => {
    expect(() =>
      assertDomEquivalent(`<a href="/x" title="go">x</a>`, html`<a href="/x" title="go">x</a>`),
    ).not.toThrow();
  });

  it("equal live form-state (value, checked) matches across attribute and property paths", () => {
    expect(() => assertDomEquivalent(`<input value="hi" />`, html`<input .value=${"hi"} />`)).not.toThrow();
    expect(() =>
      assertDomEquivalent(`<input type="checkbox" checked />`, html`<input type="checkbox" .checked=${true} />`),
    ).not.toThrow();
  });
});

describe("assertDomEquivalent fails on meaningful drift", () => {
  it("a dropped data-* attribute", () => {
    expect(() => assertDomEquivalent(`<button data-act="go"></button>`, html`<button></button>`)).toThrow(/attributes/);
  });

  it("a dropped aria-* attribute", () => {
    expect(() => assertDomEquivalent(`<button aria-label="Close"></button>`, html`<button></button>`)).toThrow(/attributes/);
  });

  it("a changed tag", () => {
    expect(() => assertDomEquivalent(`<div>x</div>`, html`<section>x</section>`)).toThrow(/tag/);
  });

  it("a changed id", () => {
    expect(() => assertDomEquivalent(`<div id="a"></div>`, html`<div id="b"></div>`)).toThrow(/attributes/);
  });

  it("a changed role, name, or type", () => {
    expect(() => assertDomEquivalent(`<div role="dialog"></div>`, html`<div role="alert"></div>`)).toThrow(/attributes/);
    expect(() => assertDomEquivalent(`<input name="a" />`, html`<input name="b" />`)).toThrow(/attributes/);
    expect(() => assertDomEquivalent(`<input type="text" />`, html`<input type="number" />`)).toThrow(/attributes/);
  });

  it("a changed or dropped class token", () => {
    expect(() => assertDomEquivalent(`<button class="btn primary"></button>`, html`<button class="btn"></button>`)).toThrow(/attributes/);
  });

  it("a changed non-enumerated attribute (href) is caught, not silently passed", () => {
    expect(() => assertDomEquivalent(`<a href="/a">x</a>`, html`<a href="/b">x</a>`)).toThrow(/attributes/);
  });

  it("a changed live value or checked state", () => {
    expect(() => assertDomEquivalent(`<input value="hi" />`, html`<input .value=${"bye"} />`)).toThrow(/attributes/);
    expect(() => assertDomEquivalent(`<input type="checkbox" />`, html`<input type="checkbox" .checked=${true} />`)).toThrow(/attributes/);
  });

  it("changed text content", () => {
    expect(() => assertDomEquivalent(`<p>old</p>`, html`<p>new</p>`)).toThrow(/text/);
  });

  it("a dropped significant space between inline elements", () => {
    expect(() => assertDomEquivalent(`<span>a</span> <span>b</span>`, html`<span>a</span><span>b</span>`)).toThrow(/child count/);
  });

  it("an extra child element", () => {
    expect(() =>
      assertDomEquivalent(`<div><span>a</span></div>`, html`<div><span>a</span><span>b</span></div>`),
    ).toThrow(/child count/);
  });

  it("a boolean attribute present on one side only", () => {
    expect(() => assertDomEquivalent(`<input />`, html`<input disabled />`)).toThrow(/attributes/);
  });

  it("a node-kind difference (text vs element) at the same position", () => {
    expect(() => assertDomEquivalent(`<div>text</div>`, html`<div><span>text</span></div>`)).toThrow(/node kind|child count/);
  });
});

describe("event-dispatch helpers", () => {
  it("dispatch fires a bubbling event that a listener receives", () => {
    const el = document.createElement("button");
    const spy = vi.fn();
    el.addEventListener("custom", spy);
    dispatch(el, "custom");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("click/change/input fire their named events", () => {
    const el = document.createElement("input");
    const clicked = vi.fn();
    const changed = vi.fn();
    const inputted = vi.fn();
    el.addEventListener("click", clicked);
    el.addEventListener("change", changed);
    el.addEventListener("input", inputted);
    click(el);
    change(el);
    input(el);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(inputted).toHaveBeenCalledTimes(1);
  });

  it("fires a lit-bound @click so the inline handler runs", () => {
    const onClick = vi.fn();
    const frag = renderToFragment(html`<button @click=${onClick}>Go</button>`);
    click(frag.querySelector("button")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a @change handler can read the value the test sets before firing", () => {
    let seen = "";
    const frag = renderToFragment(html`<input @change=${(e: Event) => (seen = (e.target as HTMLInputElement).value)} />`);
    const el = frag.querySelector("input")!;
    el.value = "typed";
    change(el);
    expect(seen).toBe("typed");
  });
});
