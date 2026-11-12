/**
 * Reads `.github/labels.yml`, the repository's one label list, for
 * `scripts/sync-labels.ts` (run by the Sync labels workflow). The list is read
 * with a narrow line reader that knows only the file's own shape (`- name:`
 * followed by `color:` and `description:`), so a color such as `5319e7` stays
 * a string instead of becoming a float the way a YAML reader would turn it.
 * It throws on an entry it cannot read rather than sync a partial list.
 */

export interface Label {
  name: string;
  color: string;
  description: string;
}

const unquote = (value: string): string => {
  const v = value.trim();
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"')
    ? v.slice(1, -1)
    : v;
};

/** Every label in the list, in file order. */
export function parseLabelList(text: string): Label[] {
  const lines = text.split(/\r?\n/);
  const labels: Label[] = [];
  for (let i = 0; i < lines.length; i++) {
    const name = /^ {2}- name: (.+)$/.exec(lines[i])?.[1];
    if (name === undefined) continue;
    const color = /^ {4}color: (.+)$/.exec(lines[i + 1] ?? "")?.[1];
    const description = /^ {4}description: (.+)$/.exec(lines[i + 2] ?? "")?.[1];
    const label = {
      name: unquote(name),
      color: unquote(color ?? ""),
      description: unquote(description ?? ""),
    };
    if (!/^[0-9a-f]{6}$/.test(label.color) || !label.description)
      throw new Error(
        `labels.yml: "${label.name}" (line ${i + 1}) needs a quoted six-digit color and a description on the next two lines`,
      );
    labels.push(label);
  }
  const names = labels.map((l) => l.name);
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) throw new Error(`labels.yml: "${dupe}" is listed twice`);
  if (labels.length === 0) throw new Error("labels.yml: no labels found");
  return labels;
}

/** The `gh` arguments that create or update one label. */
export const labelSyncArgs = (label: Label): string[] => [
  "label",
  "create",
  label.name,
  "--color",
  label.color,
  "--description",
  label.description,
  "--force",
];
