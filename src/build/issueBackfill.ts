/**
 * Reshapes an issue filed before the issue forms into its form's layout
 * (`scripts/issue-form-backfill.ts`, run by
 * `.github/workflows/issue-form-backfill.yml`). The original body moves,
 * word for word, under the form's first required text field. Every other
 * field gets its heading, with `_No response_` for an optional one and a
 * short "n/a" note for a required one, so a reader sees where the report
 * lives. Checkboxes stay unanswered: nobody ticked them when the issue was
 * filed.
 *
 * `###` headings in the original are demoted to `####` (outside code fences)
 * so they cannot be read as form fields.
 */
import { NO_RESPONSE, checkIssueBody, type IssueForm } from "./issueForms.ts";

/** The date the forms started applying to agent-filed issues. */
export const FORMS_DATE = "2026-11-12";

/** The game-mode choice a pair of mode labels stands for, if any. */
export function modeFromLabels(
  labels: string[],
  options: string[],
): string | undefined {
  const classic = labels.includes("classic");
  const modern = labels.includes("modern");
  const pick = (prefix: string) => options.find((o) => o.startsWith(prefix));
  if (classic && modern) return pick("Both");
  if (classic) return pick("Classic");
  if (modern) return pick("Modern");
  return undefined;
}

/** Demotes `### ` headings outside code fences to `#### `. */
export function demoteFieldHeadings(body: string): string {
  let fence: string | null = null;
  return body
    .split(/\r?\n/)
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === null && marker) fence = marker;
      else if (
        fence !== null &&
        marker?.[0] === fence[0] &&
        marker.length >= fence.length
      )
        fence = null;
      return fence === null && /^###\s/.test(line) ? `#${line}` : line;
    })
    .join("\n");
}

/** True when the body already has every one of the form's headings. */
export function hasFormLayout(body: string, form: IssueForm): boolean {
  return !checkIssueBody(body, form).some((p) => p.startsWith("missing"));
}

/** The body laid out in the form's fields, with the original kept whole. */
export function reshapeIssueBody(
  body: string,
  labels: string[],
  form: IssueForm,
): string {
  const asked = form.fields.filter((f) => f.type !== "markdown");
  const primary = asked.find((f) => f.required && f.type === "textarea");
  if (!primary)
    throw new Error(`the "${form.name}" form has no required text field`);
  const na = `n/a: filed before the issue forms (${FORMS_DATE}). The original report is under "${primary.label}".`;
  const sections = asked.map((field) => {
    const mode =
      field.type === "dropdown"
        ? modeFromLabels(labels, field.options)
        : undefined;
    let answer: string;
    if (field === primary) answer = demoteFieldHeadings(body.trim()) || na;
    else if (field.type === "checkboxes") answer = NO_RESPONSE;
    else if (mode !== undefined) answer = mode;
    else answer = field.required ? na : NO_RESPONSE;
    return `### ${field.label}\n\n${answer}`;
  });
  return `${sections.join("\n\n")}\n`;
}
