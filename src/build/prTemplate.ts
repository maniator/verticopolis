/**
 * The rules for a pull request description (`scripts/pr-template-check.ts`,
 * run by `.github/workflows/pr-template.yml`). GitHub fills in
 * `.github/PULL_REQUEST_TEMPLATE.md` only when a PR is opened from the website;
 * a description sent through the API or `gh pr create --body` replaces it, so
 * nothing but this check keeps an agent's PR on the template.
 *
 * A description passes when it keeps every `## ` heading the template has,
 * writes something under each one (the template's `<!-- -->` guidance does not
 * count), ticks at least one "Type of change" box, fills the "Hot-path record
 * (section 6):" line, and does not leave the bare `Closes #` placeholder.
 * The headings come from the template itself, so renaming one there moves the
 * check with it.
 */

/** The section whose checkboxes say what kind of change this is. */
export const TYPE_OF_CHANGE = "Type of change";
/** The section that carries the hot-path record line. */
export const COMPLEXITY = "Complexity";
/** The line in the Complexity section that links the section 6 record. */
export const HOT_PATH_RECORD_LINE = "Hot-path record (section 6):";

/** Text with every HTML comment removed (an unclosed one runs to the end). */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

/** The `## ` headings of a Markdown text, in order, outside comments and code fences. */
export function headings(text: string): string[] {
  return [...sections(text).keys()];
}

/**
 * Each `## ` section's body, keyed by heading, with comments removed. A body
 * runs to the next `## ` heading or a `---` rule (the generated-by footer),
 * whichever comes first. Lines inside a ``` or ~~~ code fence are body text,
 * never a heading or a rule. A repeated heading keeps its first body.
 */
export function sections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const close = () => {
    if (current !== null && !out.has(current))
      out.set(current, lines.join("\n"));
    current = null;
    lines = [];
  };
  let fence: string | null = null;
  for (const line of stripComments(text).split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      if (current !== null) lines.push(line);
      continue;
    }
    if (marker) {
      fence = marker;
      if (current !== null) lines.push(line);
      continue;
    }
    const heading = /^## +(.+?)\s*$/.exec(line);
    if (heading) {
      close();
      current = heading[1];
    } else if (/^---+\s*$/.test(line)) {
      close();
    } else if (current !== null) {
      lines.push(line);
    }
  }
  close();
  return out;
}

const CHECKED_BOX = /^\s*[-*] \[[xX]\]/m;
const BARE_CLOSES = /^\s*Closes #\s*$/m;

/** The problems with a PR description, empty when it follows the template. */
export function checkPrBody(body: string, template: string): string[] {
  const want = headings(template);
  if (want.length === 0)
    return ["the PR template has no ## headings to check against"];
  const got = sections(body);
  const problems: string[] = [];
  for (const heading of want) {
    const text = got.get(heading);
    if (text === undefined) {
      problems.push(`missing section "## ${heading}"`);
    } else if (text.trim() === "") {
      problems.push(
        `section "## ${heading}" is empty (write "None" or "n/a: <reason>" if it does not apply)`,
      );
    }
  }
  const type = got.get(TYPE_OF_CHANGE);
  if (
    want.includes(TYPE_OF_CHANGE) &&
    type?.trim() &&
    !CHECKED_BOX.test(type)
  ) {
    problems.push(`"## ${TYPE_OF_CHANGE}" ticks no box`);
  }
  const complexity = got.get(COMPLEXITY);
  if (want.includes(COMPLEXITY) && complexity?.trim()) {
    const record = complexity
      .split(/\r?\n/)
      .find((line) => line.includes(HOT_PATH_RECORD_LINE));
    // The value is what follows the label, without the emphasis or list
    // marker an author may wrap the label in ("**Hot-path record ...:** x").
    const value = record
      ?.slice(
        record.indexOf(HOT_PATH_RECORD_LINE) + HOT_PATH_RECORD_LINE.length,
      )
      .replace(/^[\s*_]+/, "")
      .trim();
    if (record === undefined) {
      problems.push(`"## ${COMPLEXITY}" has no "${HOT_PATH_RECORD_LINE}" line`);
    } else if (!value || value === "link") {
      problems.push(
        `"${HOT_PATH_RECORD_LINE}" is not filled in (link the record, or say "no hot-path surface")`,
      );
    }
  }
  if (BARE_CLOSES.test(stripComments(body))) {
    problems.push(
      `"Closes #" has no issue number (name the issue, or remove the line)`,
    );
  }
  return problems;
}
