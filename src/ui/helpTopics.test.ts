import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HELP_PAGES_DIR } from "../build/helpMarkdown";
import { HELP_TOPIC_LABEL, HELP_TOPIC_PATH, gripeTopic, isHelpTopic, type HelpTopic } from "./helpTopics";

const pagesDir = resolve(__dirname, "../..", HELP_PAGES_DIR);

/** The page file for a manual path, /help/rooms/services/ -> rooms/services.mdx. */
function pageFile(path: string): string | undefined {
  const slug = path.replace(/^\/help\/?/, "").replace(/[#?].*$/, "").replace(/\/$/, "");
  return [`${slug}.md`, `${slug}.mdx`, `${slug}/index.mdx`].map((f) => resolve(pagesDir, f)).find((f) => existsSync(f));
}

/** The heading ids a page gets, slugged the way Starlight's github-slugger
 *  does: tags dropped, lower case, anything but letters, digits, spaces and
 *  hyphens removed, spaces to hyphens. */
function headingIds(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^#{2,6} /.test(line))
    .map((line) =>
      line
        .replace(/^#+ /, "")
        .replace(/<[^>]+>/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, "")
        .replace(/ /g, "-"),
    );
}

describe("the problem lines' help topics", () => {
  const topics = Object.keys(HELP_TOPIC_PATH) as HelpTopic[];

  it.each(topics)("%s opens a page and section the manual has", (topic) => {
    const path = HELP_TOPIC_PATH[topic];
    const file = pageFile(path);
    expect(file, path).toBeDefined();
    const hash = path.split("#")[1];
    if (hash) expect(headingIds(file!), path).toContain(hash);
  });

  it("gives every topic its own screen reader label", () => {
    expect(Object.keys(HELP_TOPIC_LABEL).sort()).toEqual([...topics].sort());
    expect(new Set(Object.values(HELP_TOPIC_LABEL)).size).toBe(topics.length);
  });

  it("knows its own codes and nothing else", () => {
    expect(isHelpTopic("parking")).toBe(true);
    expect(isHelpTopic("constructor")).toBe(false);
    expect(isHelpTopic(undefined)).toBe(false);
  });

  it("sends each gripe the engine names to its page", () => {
    expect(gripeTopic("rent")).toBe("rent");
    expect(gripeTopic("noise")).toBe("noise");
    expect(gripeTopic("unmetDemand")).toBe("shops");
    expect(gripeTopic("trash")).toBe("recycling");
    expect(gripeTopic("parking")).toBe("parking");
    expect(gripeTopic("homeParking")).toBe("parking");
    expect(gripeTopic("congestion", "elevator")).toBe("elevatorWaits");
    expect(gripeTopic("congestion", "none")).toBe("elevatorWaits");
    for (const binding of ["walkways", "stairs", "escalator"]) expect(gripeTopic("congestion", binding)).toBe("walkwayWaits");
    expect(gripeTopic("relocation")).toBeUndefined();
  });
});
