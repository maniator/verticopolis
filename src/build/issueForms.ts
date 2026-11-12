/**
 * The rules for an issue body (`scripts/issue-form-check.ts`, run by
 * `.github/workflows/issue-form.yml`). GitHub applies an issue form
 * (`.github/ISSUE_TEMPLATE/*.yml`) only on its "New issue" page; an issue filed
 * through the API gets exactly the body it sends, so an agent's issue follows
 * a form only when it is written from one.
 *
 * A submitted form renders each field as `### <label>` followed by its answer,
 * with `_No response_` for an empty optional field and `- [X] <option>` for a
 * ticked checkbox. A body passes when it has every field's heading, answers
 * each required field, and ticks each required checkbox.
 *
 * The forms are read with a narrow line reader, which knows only the shape the
 * repository's forms use (two-space indents, one `labels: [...]` line,
 * `body:` items with `id`, `attributes` and `validations`). It throws on a form
 * it cannot read rather than check against nothing.
 */

export type FieldType =
  | "markdown"
  | "input"
  | "textarea"
  | "dropdown"
  | "checkboxes";

export interface FormField {
  type: FieldType;
  id: string;
  label: string;
  required: boolean;
  /** Checkbox options a submitter must tick. */
  requiredOptions: string[];
}

export interface IssueForm {
  name: string;
  labels: string[];
  fields: FormField[];
}

/** What GitHub writes for an optional field left empty. */
export const NO_RESPONSE = "_No response_";

const unquote = (value: string): string => {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0])
    return v.slice(1, -1);
  return v;
};

const indentOf = (line: string): number =>
  line.length - line.trimStart().length;

/** Reads one issue form's name, labels and fields. */
export function parseIssueForm(yaml: string): IssueForm {
  const lines = yaml.split(/\r?\n/);
  const name = unquote(/^name:\s*(.+)$/m.exec(yaml)?.[1] ?? "");
  const labelLine = /^labels:\s*\[(.*)\]\s*$/m.exec(yaml)?.[1] ?? "";
  const labels = [...labelLine.matchAll(/"([^"]+)"|'([^']+)'/g)].map(
    (m) => m[1] ?? m[2],
  );

  const fields: FormField[] = [];
  let field: FormField | null = null;
  let itemIndent = -1;
  let section = "";
  let optionIndent = -1;
  let lastOption: string | null = null;
  let inBody = false;
  for (const line of lines) {
    if (/^body:\s*$/.test(line)) {
      inBody = true;
      continue;
    }
    if (!inBody || line.trim() === "" || line.trim().startsWith("#")) continue;
    const item = /^(\s*)- type:\s*(\S+)\s*$/.exec(line);
    if (item && (itemIndent < 0 || item[1].length === itemIndent)) {
      itemIndent = item[1].length;
      field = {
        type: item[2] as FieldType,
        id: "",
        label: "",
        required: false,
        requiredOptions: [],
      };
      fields.push(field);
      section = "";
      optionIndent = -1;
      lastOption = null;
      continue;
    }
    if (!field) continue;
    const indent = indentOf(line);
    const keyIndent = itemIndent + 2;
    const key = /^\s*([a-z_]+):\s*(.*)$/.exec(line);
    if (indent === keyIndent && key) {
      section = key[1];
      if (key[1] === "id") field.id = unquote(key[2]);
      continue;
    }
    if (section === "attributes" && indent === keyIndent + 2 && key) {
      if (key[1] === "label") field.label = unquote(key[2]);
      optionIndent = key[1] === "options" ? keyIndent + 4 : -1;
      continue;
    }
    if (
      section === "validations" &&
      indent === keyIndent + 2 &&
      key?.[1] === "required"
    ) {
      field.required = unquote(key[2]) === "true";
      continue;
    }
    if (
      section === "attributes" &&
      optionIndent >= 0 &&
      field.type === "checkboxes"
    ) {
      const option = /^\s*- label:\s*(.+)$/.exec(line);
      if (option && indent === optionIndent) {
        lastOption = unquote(option[1]);
      } else if (
        key?.[1] === "required" &&
        indent === optionIndent + 2 &&
        lastOption !== null
      ) {
        if (unquote(key[2]) === "true") field.requiredOptions.push(lastOption);
      }
    }
  }
  const asked = fields.filter((f) => f.type !== "markdown");
  if (!name || asked.length === 0 || asked.some((f) => !f.label)) {
    throw new Error(
      `cannot read the issue form "${name || "(unnamed)"}": no fields, or a field without a label`,
    );
  }
  return { name, labels, fields };
}

/** Labels a form adds for triage rather than to say what kind of issue it is. */
const STATE_LABELS = new Set(["needs-triage", "classic", "modern"]);

/** Type labels the backlog uses for internal work, all filed with the Task form. */
export const TASK_TYPE_LABELS = [
  "task",
  "chore",
  "tests",
  "build",
  "tooling",
  "perf",
  "review-deferral",
];

/**
 * The form an issue with these labels should follow: the first form, in
 * `order`, whose type label (its first label that is not a triage or mode
 * label) the issue carries, with every internal-work label counting as the
 * Task form's. Undefined when no type label matches.
 */
export function formForLabels(
  issueLabels: string[],
  forms: IssueForm[],
): IssueForm | undefined {
  const has = new Set(issueLabels);
  for (const form of forms) {
    const type = form.labels.find((l) => !STATE_LABELS.has(l));
    if (!type) continue;
    const kinds = type === "task" ? TASK_TYPE_LABELS : [type];
    if (kinds.some((k) => has.has(k))) return form;
  }
  return undefined;
}

/** Each `### ` heading's answer in a submitted body, keyed by heading. */
export function answers(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const close = () => {
    if (current !== null && !out.has(current))
      out.set(current, lines.join("\n").trim());
  };
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker) fence = marker;
    else if (
      fence !== null &&
      marker?.[0] === fence[0] &&
      marker.length >= fence.length
    )
      fence = null;
    const heading = fence === null ? /^### +(.+?)\s*$/.exec(line) : null;
    if (heading) {
      close();
      current = heading[1];
      lines = [];
    } else if (current !== null) {
      lines.push(line);
    }
  }
  close();
  return out;
}

const ticked = (answer: string, option: string): boolean =>
  answer.split(/\r?\n/).some((line) => {
    const m = /^\s*[-*] \[[xX]\]\s*(.+?)\s*$/.exec(line);
    return m !== null && m[1] === option;
  });

/** The problems with an issue body against its form, empty when it follows it. */
export function checkIssueBody(body: string, form: IssueForm): string[] {
  const got = answers(body);
  const problems: string[] = [];
  for (const field of form.fields) {
    if (field.type === "markdown") continue;
    const answer = got.get(field.label);
    if (answer === undefined) {
      problems.push(`missing section "### ${field.label}"`);
      continue;
    }
    const empty = answer === "" || answer === NO_RESPONSE;
    if (field.required && empty)
      problems.push(`"### ${field.label}" is required but has no answer`);
    for (const option of field.requiredOptions) {
      if (!ticked(answer, option))
        problems.push(`"### ${field.label}" does not tick "- [x] ${option}"`);
    }
  }
  return problems;
}
