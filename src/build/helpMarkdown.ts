import { marked } from "marked";
import type { Plugin } from "vite";

/**
 * The help pages are Markdown files in `help-site/src/content/docs/`, the one
 * source for both the Help site at `/help` (Starlight reads them as they are)
 * and the game's own Help window, which imports them through this plugin.
 *
 * At build time each page becomes a small module: its front matter as plain
 * strings, and its body as a lit template whose markup is the compiled
 * Markdown, written straight into the template literal. That is the same kind
 * of static template the hand-written Help copy was, so the game renders it
 * with lit's normal `html` and no `unsafeHTML`. Nothing is parsed at run time,
 * and the Markdown compiler stays out of the game bundle.
 */

/** Where the help pages live, relative to the repository root. */
export const HELP_PAGES_DIR = "help-site/src/content/docs";

/** A help page's front matter: the fields the game reads. */
export interface HelpPageData {
  /** The page title (the Help window's section heading). */
  title: string;
  /** One line about the page (the site's meta description). */
  description: string;
  /** The page's old `/help#id` anchor, for the pages that had one. */
  helpId?: string;
}

/** A help page, compiled: its front matter and its body as HTML. `intro` is
 *  the part of the body before its first second-level heading. */
export interface CompiledHelpPage extends HelpPageData {
  html: string;
  intro: string;
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;

/** Splits a page into its front matter and its Markdown body. The front matter
 *  is the flat `key: value` subset the help pages use; a value may be quoted.
 *  Starlight's own keys (a `sidebar` block, say) are indented and skipped. */
export function parseHelpPage(source: string): { data: HelpPageData; body: string } {
  const text = source.replace(/\r\n/g, "\n");
  const match = text.match(FRONT_MATTER);
  if (!match) throw new Error("help page has no front matter");
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!pair || pair[2] === "") continue;
    const raw = pair[2].trim();
    fields.set(pair[1], /^".*"$/.test(raw) ? (JSON.parse(raw) as string) : raw);
  }
  const title = fields.get("title");
  const description = fields.get("description");
  if (!title) throw new Error("help page has no title");
  if (!description) throw new Error(`help page "${title}" has no description`);
  const helpId = fields.get("helpId");
  return { data: { title, description, ...(helpId ? { helpId } : {}) }, body: text.slice(match[0].length) };
}

/** Compiles a page's Markdown (GitHub-flavored, inline HTML such as `<kbd>`
 *  kept as written). */
export function compileHelpPage(source: string): CompiledHelpPage {
  const { data, body } = parseHelpPage(source);
  const html = (marked.parse(body, { gfm: true, async: false }) as string).trim();
  const firstSection = html.search(/<h2[\s>]/);
  const intro = (firstSection === -1 ? html : html.slice(0, firstSection)).trim();
  return { ...data, html, intro };
}

/** Text safe inside a JavaScript template literal, unchanged once evaluated. */
export function templateLiteralText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** The module a help page compiles to. */
export function helpPageModule(source: string): string {
  const page = compileHelpPage(source);
  return [
    `import { html } from "lit-html";`,
    `export const title = ${JSON.stringify(page.title)};`,
    `export const description = ${JSON.stringify(page.description)};`,
    `export const helpId = ${JSON.stringify(page.helpId ?? null)};`,
    `export const body = () => html\`${templateLiteralText(page.html)}\`;`,
    `export const intro = () => html\`${templateLiteralText(page.intro)}\`;`,
    "",
  ].join("\n");
}

/** Whether a module id is one of the help pages. */
export function isHelpPage(id: string): boolean {
  const path = id.replace(/\\/g, "/").split("?")[0];
  return path.endsWith(".md") && path.includes(`/${HELP_PAGES_DIR}/`);
}

/** The Vite plugin: turns an imported help page into its module. */
export function helpMarkdown(): Plugin {
  return {
    name: "vc-help-markdown",
    enforce: "pre",
    transform(code, id) {
      if (!isHelpPage(id)) return null;
      return { code: helpPageModule(code), map: null };
    },
  };
}
