import { describe, it, expect, vi } from "vitest";
import { helpTemplate } from "./help";
import { renderToFragment, click } from "../testing/litTestUtils";

/**
 * The Help / How-to-play dialog. Package: the semantic structure and a11y hooks
 * (the splash-gated Replay button, the external report link with rel=noopener and
 * its visually-hidden span, the autofocus primary), the inline Replay `@click`
 * dispatch, and the version auto-escape. The report-link routing through
 * the platform wrapper and the Close action live in the controller and are pinned
 * by the showHelp integration tests.
 */

const noop = { onReplay: () => {} };

describe("helpTemplate structure and a11y", () => {
  it("renders the heading and the primary Got it with autofocus", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    expect(frag.querySelector("h2")?.textContent).toBe("How to play");
    const got = frag.querySelector<HTMLButtonElement>('[data-act="close"]')!;
    expect(got.textContent).toBe("Got it");
    expect([...got.classList].sort()).toEqual(["btn", "primary"]);
    expect(got.hasAttribute("autofocus")).toBe(true);
  });

  it("keeps the report link external and screen-reader labeled", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const a = frag.querySelector<HTMLAnchorElement>(".help-report a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("href")).toContain("github.com/maniator/verticopolis/issues");
    expect(a.querySelector(".visually-hidden")?.textContent).toBe(" (opens GitHub in a new tab)");
  });

  it("interpolates the app version into the About line", () => {
    const frag = renderToFragment(helpTemplate(false, "9.9.9", noop));
    expect(frag.textContent).toContain("Verticopolis v9.9.9");
  });
});

describe("helpTemplate Replay button, gated on the splash", () => {
  it("is enabled with no title off the splash, and dispatches onReplay", () => {
    const onReplay = vi.fn();
    const frag = renderToFragment(helpTemplate(false, "1.2.3", { onReplay }));
    const replay = frag.querySelector<HTMLButtonElement>('[data-act="replay-onboard"]')!;
    expect(replay.disabled).toBe(false);
    expect(replay.hasAttribute("title")).toBe(false);
    click(replay);
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("is disabled with an explaining title while the splash is up", () => {
    const onReplay = vi.fn();
    const frag = renderToFragment(helpTemplate(true, "1.2.3", { onReplay }));
    const replay = frag.querySelector<HTMLButtonElement>('[data-act="replay-onboard"]')!;
    expect(replay.disabled).toBe(true);
    expect(replay.getAttribute("title")).toBe("Start a tower first, then you can replay the intro.");
  });
});

describe("helpTemplate escapes the interpolated version as text", () => {
  it("renders a hostile version string as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(helpTemplate(false, hostile, noop));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(`Verticopolis v${hostile}`);
  });
});
