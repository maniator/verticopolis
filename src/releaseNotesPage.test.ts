import { describe, it, expect, vi } from "vitest";
import { releaseNotesPageTemplate, versionSection } from "./releaseNotesPage";
import { openedFromGame } from "./ui/fromGame";
import { releaseNotesHref } from "./ui/templates/updatePrompt";
import { render } from "lit-html";
import { renderToFragment } from "./ui/testing/litTestUtils";

/**
 * The standalone release notes page, `/help/changelog`. Importing this module
 * runs its `main()` once, which no-ops in the test DOM (no `#app`), so the
 * pure `releaseNotesPageTemplate()` is what these assert on, fed canned notes.
 */
const RELEASES = [
  { version: "3.2.0", notes: ["Newest first.", "Every note whole: " + "y".repeat(1500)] },
  { version: "3.1.0", notes: ["Older."] },
];

describe("releaseNotesPageTemplate", () => {
  it("leads with the Release notes heading", () => {
    const frag = renderToFragment(releaseNotesPageTemplate(RELEASES));
    expect(frag.querySelector("h1")?.textContent).toBe("Release notes");
  });

  it("renders one section per version, newest first, whose id is the version", () => {
    const frag = renderToFragment(releaseNotesPageTemplate(RELEASES));
    const sections = [...frag.querySelectorAll("section.help-section")];
    expect(sections.map((s) => s.id)).toEqual(["3.2.0", "3.1.0"]);
    expect(sections.map((s) => s.querySelector("h2")?.textContent)).toEqual(["3.2.0", "3.1.0"]);
    // Each section is named by its own heading for screen-reader landmarks.
    expect(sections[0].getAttribute("aria-labelledby")).toBe(sections[0].querySelector("h2")?.id);
  });

  it("shows every note whole", () => {
    const frag = renderToFragment(releaseNotesPageTemplate(RELEASES));
    const notes = [...frag.querySelectorAll("section[id='3.2.0'] li")].map((li) => li.textContent);
    expect(notes).toEqual(RELEASES[0].notes);
  });

  it("renders a hostile note and version as text", () => {
    const frag = renderToFragment(releaseNotesPageTemplate([{ version: "<b>9</b>", notes: ["<img src=x onerror=alert(1)>"] }]));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.querySelector("section b")).toBeNull();
    expect(frag.querySelector("section li")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("says when a build carries no notes, rather than showing an empty page", () => {
    const frag = renderToFragment(releaseNotesPageTemplate([]));
    expect(frag.querySelectorAll("section[id]")).toHaveLength(0);
    expect(frag.textContent).toContain("No release notes are available in this build.");
  });

  it("links to How to Play, the gallery and back to the game", () => {
    const frag = renderToFragment(releaseNotesPageTemplate(RELEASES));
    const hrefs = [...frag.querySelectorAll(".page-nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/help", "/gallery", "/"]);
  });
});

describe("versionSection", () => {
  const mount = () => {
    const root = document.createElement("div");
    render(releaseNotesPageTemplate(RELEASES), root);
    document.body.replaceChildren(root);
  };

  it("finds the section a #version fragment names, including an escaped one", () => {
    mount();
    expect(versionSection("#3.1.0")?.id).toBe("3.1.0");
    expect(versionSection("#3%2E1%2E0")?.id).toBe("3.1.0");
  });

  it("returns null for no fragment, an unknown version or a malformed escape", () => {
    mount();
    expect(versionSection("")).toBeNull();
    expect(versionSection("#")).toBeNull();
    expect(versionSection("#9.9.9")).toBeNull();
    expect(() => versionSection("#3.2%")).not.toThrow();
    expect(versionSection("#3.2%")).toBeNull();
  });
});

describe("Back to game on a page the game opened", () => {
  it("matches the address the update prompt links to", () => {
    expect(openedFromGame(new URL(releaseNotesHref("3.2.0"), "https://example.test").search)).toBe(true);
  });

  it("is a plain link to the game for a visitor from anywhere else", () => {
    const frag = renderToFragment(releaseNotesPageTemplate(RELEASES));
    expect(frag.querySelector("#back-note")).toBeNull();
    const back = frag.querySelector<HTMLAnchorElement>('a[data-act="back-to-game"]')!;
    const click = new MouseEvent("click", { cancelable: true, bubbles: true });
    back.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("closes the tab instead of navigating, when the game opened it", () => {
    const root = document.createElement("div");
    render(releaseNotesPageTemplate(RELEASES, true), root);
    document.body.replaceChildren(root);
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const click = new MouseEvent("click", { cancelable: true, bubbles: true });
    root.querySelector('a[data-act="back-to-game"]')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });
});
