import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "lit-html";
import * as privacy from "../../help-site/src/content/docs/privacy.md";
import {
  HELP_PAGES_DIR,
  compileHelpPage,
  helpMarkdown,
  helpPageModule,
  isHelpPage,
  parseHelpPage,
  templateLiteralText,
} from "./helpMarkdown";

const PAGE = `---
title: "Keyboard: play"
description: Every key.
---

Lead with **bold** and <kbd>Esc</kbd>.

## Later

- One
`;

describe("parseHelpPage", () => {
  it("reads the flat front matter, unquoting a quoted value, and returns the body", () => {
    const { data, body } = parseHelpPage(PAGE);
    expect(data).toEqual({ title: "Keyboard: play", description: "Every key." });
    expect(body.startsWith("\nLead with")).toBe(true);
  });

  it("skips nested keys such as a Starlight sidebar block", () => {
    const { data } = parseHelpPage("---\ntitle: T\ndescription: D\nsidebar:\n  order: 2\n---\nBody\n");
    expect(data).toEqual({ title: "T", description: "D" });
  });

  it("refuses a page without front matter, a title or a description", () => {
    expect(() => parseHelpPage("# No front matter\n")).toThrow(/front matter/);
    expect(() => parseHelpPage("---\ndescription: D\n---\n")).toThrow(/title/);
    expect(() => parseHelpPage("---\ntitle: T\n---\n")).toThrow(/description/);
  });
});

describe("compileHelpPage", () => {
  it("compiles the body, keeps inline HTML, and splits the intro at the first section", () => {
    const page = compileHelpPage(PAGE);
    expect(page.html).toContain("<strong>bold</strong>");
    expect(page.html).toContain("<kbd>Esc</kbd>");
    expect(page.html).toContain("<h2>Later</h2>");
    expect(page.intro).toBe("<p>Lead with <strong>bold</strong> and <kbd>Esc</kbd>.</p>");
  });

  it("uses the whole body as the intro when there is no section", () => {
    const page = compileHelpPage("---\ntitle: T\ndescription: D\n---\n\nJust this.\n");
    expect(page.intro).toBe(page.html);
  });
});

describe("templateLiteralText", () => {
  it("escapes what a template literal would read: backslashes, backticks and ${", () => {
    const text = "a \\ b ` c ${d} $e";
    const evaluated = new Function(`return \`${templateLiteralText(text)}\`;`)() as string;
    expect(evaluated).toBe(text);
  });
});

describe("helpPageModule", () => {
  it("exports the front matter and the body as lit templates", () => {
    const code = helpPageModule(PAGE);
    expect(code).toContain('import { html } from "lit-html";');
    expect(code).toContain('export const title = "Keyboard: play";');
    expect(code).toContain("export const body = () => html`");
    expect(code).toContain("export const intro = () => html`<p>Lead with");
  });
});

describe("the plugin", () => {
  it("handles only Markdown files in the help pages folder", () => {
    expect(isHelpPage(`/repo/${HELP_PAGES_DIR}/keyboard.md`)).toBe(true);
    expect(isHelpPage(`C:\\repo\\help-site\\src\\content\\docs\\keyboard.md?import`)).toBe(true);
    expect(isHelpPage("/repo/README.md")).toBe(false);
    expect(isHelpPage(`/repo/${HELP_PAGES_DIR}/keyboard.ts`)).toBe(false);
  });

  it("transforms a help page and leaves every other module alone", () => {
    const plugin = helpMarkdown();
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    expect(transform(PAGE, `/repo/${HELP_PAGES_DIR}/keyboard.md`)?.code).toBe(helpPageModule(PAGE));
    expect(transform("export {}", "/repo/src/main.ts")).toBeNull();
  });
});

describe("the help pages", () => {
  const dir = resolve(__dirname, "../..", HELP_PAGES_DIR);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  it("every page compiles, with a title and a description", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const page = compileHelpPage(readFileSync(resolve(dir, file), "utf8"));
      expect(page.title, file).not.toBe("");
      expect(page.html, file).not.toBe("");
    }
  });

  it("an imported page renders its compiled Markdown through lit", () => {
    const root = document.createElement("div");
    render(privacy.body(), root);
    const expected = document.createElement("div");
    expected.innerHTML = compileHelpPage(readFileSync(resolve(dir, "privacy.md"), "utf8")).html;
    expect(root.querySelectorAll("p").length).toBeGreaterThan(2);
    expect(root.textContent?.trim()).toBe(expected.textContent?.trim());
    expect(privacy.title).toBe("Privacy");
  });
});
