import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BROWSER_OPTION, MAX_DIAGNOSTICS, MODE_OPTION, PLATFORM_OPTION, bugReportHref, browserOption, isMobileDevice } from "./bugReport";

/** Real user agent strings, trimmed to the parts the picker reads. */
const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
};

function fields(href: string): URLSearchParams {
  const url = new URL(href);
  expect(url.origin + url.pathname).toBe("https://github.com/maniator/verticopolis/issues/new");
  return url.searchParams;
}

describe("browserOption", () => {
  it("names Edge before the Chrome it also claims", () => {
    expect(browserOption(UA.edge)).toBe(BROWSER_OPTION.edge);
  });
  it("names Chrome on desktop and on iOS", () => {
    expect(browserOption(UA.chrome)).toBe(BROWSER_OPTION.chrome);
    expect(browserOption(UA.iosChrome)).toBe(BROWSER_OPTION.chrome);
  });
  it("names Firefox and Safari", () => {
    expect(browserOption(UA.firefox)).toBe(BROWSER_OPTION.firefox);
    expect(browserOption(UA.safari)).toBe(BROWSER_OPTION.safari);
  });
  it("falls back to Other for anything it does not know", () => {
    expect(browserOption("SomeBrowser/1.0")).toBe(BROWSER_OPTION.other);
  });
});

describe("isMobileDevice", () => {
  it("counts phones and Android", () => {
    expect(isMobileDevice({ userAgent: UA.iosChrome, maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: UA.android, maxTouchPoints: 5 })).toBe(true);
  });
  it("counts an iPad that reports a Mac, but not a Mac without touch", () => {
    expect(isMobileDevice({ userAgent: UA.safari, maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: UA.safari, maxTouchPoints: 0 })).toBe(false);
  });
  it("leaves a Windows desktop as desktop", () => {
    expect(isMobileDevice({ userAgent: UA.chrome, maxTouchPoints: 0 })).toBe(false);
  });
});

describe("bugReportHref", () => {
  const base = { versionLine: "v3.4.0 · Rust engine 1.27.0 (1a2b3c4d5e6f)", userAgent: UA.firefox, mobile: false, mode: "modern" as const };

  it("opens the bug form with every known field set to one of its choices", () => {
    const q = fields(bugReportHref({ ...base, diagnostics: "App: v3.4.0\nEngine in use: Rust engine" }));
    expect(q.get("template")).toBe("bug_report.yml");
    expect(q.get("version")).toBe(base.versionLine);
    expect(q.get("diagnostics")).toBe("App: v3.4.0\nEngine in use: Rust engine");
    expect(q.get("browser")).toBe("Firefox");
    expect(q.get("platform")).toBe("Desktop");
    expect(q.get("mode")).toBe("Modern");
  });

  it("says Mobile / tablet, Classic, and Not sure where they apply", () => {
    expect(fields(bugReportHref({ ...base, mobile: true })).get("platform")).toBe("Mobile / tablet");
    expect(fields(bugReportHref({ ...base, mode: "classic" })).get("mode")).toBe("Classic");
    expect(fields(bugReportHref({ ...base, mode: null })).get("mode")).toBe("Not sure");
  });

  it("leaves the diagnostics field out when there are none", () => {
    expect(fields(bugReportHref(base)).has("diagnostics")).toBe(false);
    expect(fields(bugReportHref({ ...base, diagnostics: "  " })).has("diagnostics")).toBe(false);
  });

  it("cuts long diagnostics so the URL stays one GitHub accepts", () => {
    const q = fields(bugReportHref({ ...base, diagnostics: "x".repeat(MAX_DIAGNOSTICS + 500) }));
    expect(q.get("diagnostics")).toBe(`${"x".repeat(MAX_DIAGNOSTICS)}\n…`);
  });

  it("reads the user agent only to pick the Browser choice", () => {
    expect(bugReportHref(base)).not.toContain("Gecko");
  });
});

describe("the bug form's choices", () => {
  it("match the options in the issue form", () => {
    // A renamed choice in the form would silently stop prefilling that field.
    const form = readFileSync(resolve(process.cwd(), ".github/ISSUE_TEMPLATE/bug_report.yml"), "utf8").replace(/\r\n/g, "\n");
    for (const option of [...Object.values(BROWSER_OPTION), ...Object.values(PLATFORM_OPTION), ...Object.values(MODE_OPTION)]) {
      expect(form, `bug_report.yml has no "${option}" choice`).toContain(`- ${option}\n`);
    }
    for (const id of ["version", "diagnostics", "browser", "platform", "mode"]) expect(form).toContain(`id: ${id}\n`);
  });
});
