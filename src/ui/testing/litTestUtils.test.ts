import { describe, it, expect, vi } from "vitest";
import { html } from "lit-html";
import { renderToFragment, dispatch, click, change, input } from "./litTestUtils";

/**
 * Unit tests for the lit test harness itself, so every template test can trust
 * it. `renderToFragment` yields readable nodes (no lit markers); the event
 * helpers fire real events that inline `@click`/`@change` bindings receive. The
 * transitional `assertDomEquivalent` guard and its tests retired with the
 * string builders in the final migration sweep (git history keeps them).
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
