import { describe, it, expect, vi } from "vitest";
import { releaseNotesHref, updatePromptTemplate } from "./updatePrompt";
import { renderToFragment, click } from "../testing/litTestUtils";
import type { UpdateInfo } from "../../pwa";

/**
 * The "update available" prompt. Its per-aspect package: a semantic structure
 * check (incl. the optional What's-new and build-id blocks), the inline `@click`
 * dispatch (Later / Update now), and hostile input rendered as text. The live
 * resolve-once behavior across all four dismissal paths lives in the controller
 * and is pinned by `uiDialogs.integration.test.ts`.
 */

const noop = { onLater: () => {}, onUpdate: () => {} };
const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({ version: "1.6.0", sha: "abc1234", notes: [], ...over });

describe("updatePromptTemplate update kind", () => {
  it("labels the update as game, engine, or both", () => {
    const label = (kind: "game" | "engine" | "both") =>
      renderToFragment(updatePromptTemplate(info({ kind }), noop)).querySelector(".update-kind")?.textContent;
    expect(label("game")).toBe("Game update");
    expect(label("engine")).toBe("Engine update");
    expect(label("both")).toBe("Game and engine update");
  });

  it("shows the engine line above the build line, and neither when absent", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ kind: "engine", engineLine: "Rust engine 0.24.0 → 0.25.0" }), noop));
    expect([...frag.querySelectorAll(".build-id")].map((p) => p.textContent)).toEqual(["Rust engine 0.24.0 → 0.25.0", "Build 1.6.0 · abc1234"]);
    const plain = renderToFragment(updatePromptTemplate(info(), noop));
    expect(plain.querySelector(".update-kind")).toBeNull();
    expect(plain.querySelectorAll(".build-id")).toHaveLength(1);
  });

  it("renders the engine line as text", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ kind: "engine", engineLine: "<img src=x onerror=alert(1)>" }), noop));
    expect(frag.querySelector("img")).toBeNull();
  });
});

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

  it("renders up to three release notes as a plain list, with the build-id from info", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ notes: ["a", "b", "c"] }), noop));
    expect([...frag.querySelectorAll(".whatsnew li")].map((li) => li.textContent)).toEqual(["a", "b", "c"]);
    expect(frag.querySelector(".whatsnew-log")).toBeNull();
    expect(frag.querySelector(".build-id")?.textContent).toBe("Build 1.6.0 · abc1234");
  });

  it("puts every note of a longer release, whole, in a labeled, focusable log", () => {
    const long = "A long note. ".repeat(40).trim();
    const notes = ["a", "b", "c", "d", long];
    const frag = renderToFragment(updatePromptTemplate(info({ notes }), noop));
    const log = frag.querySelector(".whatsnew-log");
    expect(log?.getAttribute("tabindex")).toBe("0");
    expect(log?.getAttribute("role")).toBe("region");
    expect(log?.getAttribute("aria-labelledby")).toBe("whatsnew-title");
    expect(frag.getElementById("whatsnew-title")?.textContent).toBe("What's new");
    expect(frag.querySelector(".whatsnew-ver")).toBeNull();
    expect([...frag.querySelectorAll(".whatsnew-log li")].map((li) => li.textContent)).toEqual(notes);
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

describe("updatePromptTemplate skipped versions (#1897)", () => {
  const rel = (version: string, ...notes: string[]) => ({ version, notes });

  it("keeps the single-list look when only the incoming version is new", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ notes: ["One."], releases: [rel("1.6.0", "One.")], since: "1.5.0" }), noop));
    expect(frag.querySelector(".whatsnew-log")).toBeNull();
    expect(frag.querySelector(".whatsnew h3")?.textContent).toBe("What's new");
    expect([...frag.querySelectorAll(".whatsnew li")].map((li) => li.textContent)).toEqual(["One."]);
  });

  it("lists every skipped version newest first in a labeled, focusable log", () => {
    const frag = renderToFragment(
      updatePromptTemplate(info({ notes: ["New."], releases: [rel("1.6.0", "New."), rel("1.5.1", "Fix."), rel("1.5.0", "A.", "B.")], since: "1.4.0" }), noop),
    );
    expect(frag.querySelector(".whatsnew h3")?.textContent).toBe("What's new since 1.4.0");
    const log = frag.querySelector(".whatsnew-log");
    expect(log?.getAttribute("tabindex")).toBe("0");
    expect(log?.getAttribute("role")).toBe("region");
    expect(log?.getAttribute("aria-labelledby")).toBe("whatsnew-title");
    // The dialog opens on Later, never inside the focusable log.
    expect(frag.querySelector('[data-act="later"]')?.hasAttribute("autofocus")).toBe(true);
    expect(frag.getElementById("whatsnew-title")).not.toBeNull();
    expect([...frag.querySelectorAll(".whatsnew-ver")].map((h) => h.textContent)).toEqual(["1.6.0", "1.5.1", "1.5.0"]);
    expect([...frag.querySelectorAll(".whatsnew-log li")].map((li) => li.textContent)).toEqual(["New.", "Fix.", "A.", "B."]);
    expect(frag.querySelector(".whatsnew-more")).toBeNull();
  });

  it("labels a lone skipped version when the incoming build has no notes of its own", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ notes: [], releases: [rel("1.5.1", "Fix.")], since: "1.5.0" }), noop));
    expect([...frag.querySelectorAll(".whatsnew-ver")].map((h) => h.textContent)).toEqual(["1.5.1"]);
  });

  it("says when earlier updates are not listed", () => {
    const frag = renderToFragment(updatePromptTemplate(info({ releases: [rel("1.6.0", "N."), rel("1.5.0", "O.")], more: true }), noop));
    expect(frag.querySelector(".whatsnew-more")?.textContent).toBe("Earlier updates are not listed here.");
  });

  it("renders a hostile version and note as text", () => {
    const frag = renderToFragment(
      updatePromptTemplate(info({ releases: [rel("<img src=x>", "<script>x</script>"), rel("1.5.0", "<b>o</b>")], since: "<i>1</i>" }), noop),
    );
    expect(frag.querySelector("img, script, b, i")).toBeNull();
  });
});

describe("updatePromptTemplate release notes link", () => {
  const withNotes = info({ notes: ["One."] });
  const link = (frag: DocumentFragment) => frag.querySelector<HTMLAnchorElement>('a[data-act="release-notes"]');

  it("links to the incoming version's section of the release notes page, in a new tab", () => {
    const a = link(renderToFragment(updatePromptTemplate(withNotes, noop, { releaseNotesLink: true })));
    expect(a?.getAttribute("href")).toBe("/help/changelog?from=game#1.6.0");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.textContent).toBe("All release notes (opens in a new tab)");
  });

  it("sits after the notes and before the actions, never in the actions row", () => {
    const frag = renderToFragment(updatePromptTemplate(withNotes, noop, { releaseNotesLink: true }));
    const a = link(frag)!;
    expect(a.closest(".modal-actions")).toBeNull();
    const whatsnew = frag.querySelector(".whatsnew")!;
    const actions = frag.querySelector(".modal-actions")!;
    expect(whatsnew.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(a.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("also follows the skipped-versions log", () => {
    const skipped = info({ notes: ["New."], releases: [{ version: "1.6.0", notes: ["New."] }, { version: "1.5.0", notes: ["Old."] }], since: "1.4.0" });
    expect(link(renderToFragment(updatePromptTemplate(skipped, noop, { releaseNotesLink: true })))?.getAttribute("href")).toBe("/help/changelog?from=game#1.6.0");
  });

  it("is absent unless the controller asks for it (the installed app)", () => {
    expect(link(renderToFragment(updatePromptTemplate(withNotes, noop)))).toBeNull();
    expect(link(renderToFragment(updatePromptTemplate(withNotes, noop, { releaseNotesLink: false })))).toBeNull();
  });

  it("is absent when the update carries no notes to read more of", () => {
    expect(link(renderToFragment(updatePromptTemplate(info(), noop, { releaseNotesLink: true })))).toBeNull();
  });

  it("encodes the version into the fragment and falls back to the page top", () => {
    expect(releaseNotesHref("1.6.0")).toBe("/help/changelog?from=game#1.6.0");
    expect(releaseNotesHref("1.6.0 beta")).toBe("/help/changelog?from=game#1.6.0%20beta");
    expect(releaseNotesHref(undefined)).toBe("/help/changelog?from=game");
  });
});
