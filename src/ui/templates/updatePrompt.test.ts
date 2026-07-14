import { describe, it, expect, vi } from "vitest";
import { updatePromptHtml } from "../uiTemplates";
import { updatePromptTemplate } from "./updatePrompt";
import { renderToFragment, assertDomEquivalent, click } from "../testing/litTestUtils";
import type { UpdateInfo } from "../../pwa";

/**
 * The "update available" prompt. Its per-aspect package: a semantic structure
 * check (incl. the optional What's-new and build-id blocks), the inline `@click`
 * dispatch (Later / Update now), hostile input rendered as text, and the
 * transitional `assertDomEquivalent` guard against `updatePromptHtml` across the
 * present/absent/hostile/empty input classes. The live resolve-once behavior
 * across all four dismissal paths lives in the controller and is pinned by
 * `uiDialogs.integration.test.ts`.
 */

const noop = { onLater: () => {}, onUpdate: () => {} };
const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({ version: "1.6.0", sha: "abc1234", notes: [], ...over });

describe("updatePromptTemplate structure", () => {
  it("renders the heading, body copy, and a Later/Update-now actions row", () => {
    const frag = renderToFragment(updatePromptTemplate(null, noop));
    expect(frag.querySelector("h2")?.textContent).toBe("Update available");
    const buttons = frag.querySelectorAll(".modal-actions button");
    expect(buttons).toHaveLength(2);
    expect(frag.querySelector('[data-act="later"]')?.textContent).toBe("Later");
    const update = frag.querySelector('[data-act="update"]')!;
    expect(update.textContent).toBe("Update now");
    expect(update.classList.contains("primary")).toBe(true);
  });

  it("omits the What's-new block and build-id line when there is no info", () => {
    const frag = renderToFragment(updatePromptTemplate(null, noop));
    expect(frag.querySelector(".whatsnew")).toBeNull();
    expect(frag.querySelector(".build-id")).toBeNull();
  });

  it("renders up to three release notes and the build-id from info", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ notes: ["a", "b", "c", "d"] }), noop));
    const items = frag.querySelectorAll(".whatsnew li");
    expect(items).toHaveLength(3); // capped at three
    expect([...items].map((li) => li.textContent)).toEqual(["a", "b", "c"]);
    expect(frag.querySelector(".build-id")?.textContent).toBe("Build 1.6.0 · abc1234");
  });

  it("drops the 'unknown' sha placeholder from the build line", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ sha: "unknown" }), noop));
    expect(frag.querySelector(".build-id")?.textContent).toBe("Build 1.6.0");
  });

  it("renders a sha-only build line when the version is absent", () => {
    // version is optional on UpdateInfo, so omit it rather than force undefined.
    const frag = renderToFragment(updatePromptTemplate({ sha: "abc1234", notes: [] }, noop));
    expect(frag.querySelector(".build-id")?.textContent).toBe("Build abc1234");
  });

  it("renders no [data-act=close] button (the x closes via the cancel path)", () => {
    const frag = renderToFragment(updatePromptTemplate(info(), noop));
    expect(frag.querySelector('[data-act="close"]')).toBeNull();
  });
});

describe("updatePromptTemplate inline actions", () => {
  it("Update now dispatches onUpdate, not onLater", () => {
    const onLater = vi.fn();
    const onUpdate = vi.fn();
    const frag = renderToFragment(updatePromptTemplate(null, { onLater, onUpdate }));
    click(frag.querySelector('[data-act="update"]')!);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onLater).not.toHaveBeenCalled();
  });

  it("Later dispatches onLater, not onUpdate", () => {
    const onLater = vi.fn();
    const onUpdate = vi.fn();
    const frag = renderToFragment(updatePromptTemplate(null, { onLater, onUpdate }));
    click(frag.querySelector('[data-act="later"]')!);
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("updatePromptTemplate escapes interpolated copy as text", () => {
  it("renders a hostile release note as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(updatePromptTemplate(info({ notes: [hostile] }), noop));
    expect(frag.querySelector(".whatsnew img")).toBeNull();
    expect(frag.querySelector(".whatsnew li")?.textContent).toBe(hostile);
  });
});

describe("updatePromptTemplate matches the legacy updatePromptHtml structure", () => {
  it("holds with notes and a build id", () => {
    const i = info({ notes: ["Faster boot", "Fixed a save bug"] });
    expect(() => assertDomEquivalent(updatePromptHtml(i), updatePromptTemplate(i, noop))).not.toThrow();
  });

  it("holds with no info (blocks absent)", () => {
    expect(() => assertDomEquivalent(updatePromptHtml(null), updatePromptTemplate(null, noop))).not.toThrow();
  });

  it("holds with a version but no notes and an unknown sha", () => {
    const i = info({ sha: "unknown", notes: [] });
    expect(() => assertDomEquivalent(updatePromptHtml(i), updatePromptTemplate(i, noop))).not.toThrow();
  });

  it("holds for a hostile note: lit auto-escape agrees with the legacy escapeHtml", () => {
    // The migration's premise is that lit escaping matches the old escapeHtml. Pin
    // it against a note carrying every character escapeHtml touches, so old and new
    // provably produce the SAME text (not just that lit escapes).
    const i = info({ notes: [`<b>bold</b> & "quote" 'apos'`] });
    expect(() => assertDomEquivalent(updatePromptHtml(i), updatePromptTemplate(i, noop))).not.toThrow();
  });

  it("holds at the notes cap: 4 notes render 3 on both paths", () => {
    const i = info({ notes: ["a", "b", "c", "d"] });
    expect(() => assertDomEquivalent(updatePromptHtml(i), updatePromptTemplate(i, noop))).not.toThrow();
  });
});
