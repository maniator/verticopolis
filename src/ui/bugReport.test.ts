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

  it("keeps diagnostics of exactly the limit whole and cuts one character more", () => {
    const atLimit = "y".repeat(MAX_DIAGNOSTICS);
    expect(fields(bugReportHref({ ...base, diagnostics: atLimit })).get("diagnostics")).toBe(atLimit);
    const overLimit = `${atLimit}z`;
    expect(fields(bugReportHref({ ...base, diagnostics: overLimit })).get("diagnostics")).toBe(`${atLimit}\n…`);
  });

  it("without diagnostics, the raw browser string never reaches the link", () => {
    // The user agent only picks the Browser choice; the string itself is not a field.
    const href = bugReportHref(base);
    expect(href).not.toContain("Gecko");
    expect(href).not.toContain(encodeURIComponent("Gecko/20100101"));
    expect(fields(href).get("browser")).toBe("Firefox");
  });
});

describe("bugReportHref with a real diagnostics report", () => {
  // The shape About this game's Copy diagnostics gives (src/wasmhost/engineDiagnostics.ts):
  // the full browser string, the time of the report and the engine's own error
  // text, which can quote a tower name.
  const DATE = "2026-11-13T09:41:07.000Z";
  const TOWER_QUOTE = "tower \"Naomi's Plaza\" has a bad floor";
  const diagnostics = [
    "Verticopolis diagnostics",
    "The Rust engine is running and matches this build.",
    "App: v3.4.0 (cf91737)",
    `Date: ${DATE}`,
    `Browser: ${UA.firefox}`,
    "Engine in use: Rust engine",
    `Last engine error: ${TOWER_QUOTE}`,
  ].join("\n");
  const facts = { versionLine: "v3.4.0 · Rust engine 1.27.0 (1a2b3c4d5e6f)", diagnostics, userAgent: UA.firefox, mobile: false, mode: "classic" as const };

  it("carries the whole report, browser string, time and error text included, in the diagnostics field", () => {
    const q = fields(bugReportHref(facts));
    expect(q.get("diagnostics")).toBe(diagnostics);
    expect(q.get("diagnostics")).toContain(`Browser: ${UA.firefox}`);
    expect(q.get("diagnostics")).toContain(`Date: ${DATE}`);
    expect(q.get("diagnostics")).toContain(TOWER_QUOTE);
  });

  it("sends nothing outside the form's own fields, and none of the report leaks into them", () => {
    const q = fields(bugReportHref(facts));
    expect([...q.keys()].sort()).toEqual(["browser", "diagnostics", "mode", "platform", "template", "version"]);
    expect(Object.fromEntries([...q].filter(([key]) => key !== "diagnostics"))).toEqual({
      template: "bug_report.yml",
      version: facts.versionLine,
      browser: "Firefox",
      platform: "Desktop",
      mode: "Classic",
    });
  });

  it("encodes the report so its own separators cannot add or change a field", () => {
    const forged = `${diagnostics}\nmode=Modern&platform=Mobile#top`;
    const href = bugReportHref({ ...facts, diagnostics: forged });
    const q = fields(href);
    expect(q.get("diagnostics")).toBe(forged);
    expect(q.get("mode")).toBe("Classic");
    expect(q.get("platform")).toBe("Desktop");
    expect(q.getAll("mode")).toHaveLength(1);
    expect(new URL(href).hash).toBe("");
  });

  it("cuts a very long report at the limit and round-trips its non-ASCII text", () => {
    const long = `${diagnostics}\nDetail: ${"塔".repeat(MAX_DIAGNOSTICS)}`;
    const href = bugReportHref({ ...facts, diagnostics: long });
    const sent = fields(href).get("diagnostics") ?? "";
    expect(sent).toBe(`${long.slice(0, MAX_DIAGNOSTICS)}\n…`);
    expect(sent.length).toBe(MAX_DIAGNOSTICS + 2);
    // Each 塔 is three UTF-8 bytes, nine characters once percent-encoded, so the
    // cut is what keeps the link near 18,000 characters rather than growing with the report.
    expect(href).toContain(encodeURIComponent("塔"));
    expect(href.length).toBeLessThan(MAX_DIAGNOSTICS * 9 + 1000);
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
