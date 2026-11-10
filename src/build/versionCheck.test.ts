import { describe, expect, it } from "vitest";
import { checkFeature, checkRelease, type Change, type Tree } from "./versionCheck";

type Files = Record<string, string>;

const pkg = (v: string) => JSON.stringify({ name: "x", version: v });
const npmLock = (v: string) => JSON.stringify({ name: "x", version: v, packages: { "": { name: "x", version: v } } });
const toml = (v: string) => `[package]\nname = "verticopolis-engine"\nversion = "${v}"\n`;
const cargoLock = (v: string) => `[[package]]\nname = "verticopolis-engine"\nversion = "${v}"\n`;
const record = (v: string, lock = "aaaa") => JSON.stringify({ crateVersion: v, lockDigest: lock, saveVersion: 7 });
const note = (app: string, crate: string) =>
  `---\napp: ${app}\ncrate: ${crate}\n---\n${app === "none" ? "" : "## Player\n- A player line.\n"}${crate === "none" ? "" : "## Engine\n- An engine line.\n"}`;

/** Main at app 2.89.1 and crate 1.22.0, plus `extra`. */
function main(extra: Files = {}): Files {
  return {
    "package.json": pkg("2.89.1"),
    "package-lock.json": npmLock("2.89.1"),
    "CHANGELOG.md": "# Changelog\n\n## 2.89.1\n\n- Old.\n",
    "engine-rs/Cargo.toml": toml("1.22.0"),
    "engine-rs/Cargo.lock": cargoLock("1.22.0"),
    "engine-rs/consumer/Cargo.lock": cargoLock("1.22.0"),
    "engine-rs/CHANGELOG.md": "# Engine changelog\n\n## 1.22.0 (2026-11-10)\n\n- Old.\n",
    "engine-rs/src/compat-record.json": record("1.22.0"),
    "src/a.ts": "a",
    ...extra,
  };
}

function tree(files: Files): Tree {
  return {
    read: (p) => files[p] ?? null,
    notes: () =>
      Object.keys(files)
        .filter((p) => /^\.changes\/[^/]+\.md$/.test(p) && p !== ".changes/README.md")
        .map((p) => p.slice(".changes/".length)),
  };
}

/** What `git diff --name-status` would list between two trees. */
function diff(a: Files, b: Files): Change[] {
  const out: Change[] = [];
  for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(p in b)) out.push({ status: "D", path: p });
    else if (!(p in a)) out.push({ status: "A", path: p });
    else if (a[p] !== b[p]) out.push({ status: "M", path: p });
  }
  return out;
}

const feature = (base: Files, head: Files, deployed = ["src/a.ts", "package.json"]) =>
  checkFeature(tree(base), tree(head), diff(base, head), new Set(deployed));
const release = (base: Files, head: Files) => checkRelease(tree(base), tree(head), diff(base, head));

describe("a feature PR", () => {
  it("passes with a note beside a deployed change, and without one for a skipped path", () => {
    expect(feature(main(), main({ "src/a.ts": "b", ".changes/topic.md": note("minor", "none") }))).toEqual([]);
    expect(feature(main(), main({ "docs/a.md": "b" }))).toEqual([]);
    // A none note counts.
    expect(feature(main(), main({ "src/a.ts": "b", ".changes/topic.md": note("none", "none") }))).toEqual([]);
  });

  it("needs a note when it changes a deployed path", () => {
    const errors = feature(main(), main({ "src/a.ts": "b" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/src\/a\.ts.*no \.changes note/);
    // Dependabot cannot write one; its version lines still hold.
    expect(checkFeature(tree(main()), tree(main({ "src/a.ts": "b" })), [{ status: "M", path: "src/a.ts" }], new Set(["src/a.ts"]), true)).toEqual([]);
    expect(checkFeature(tree(main()), tree(main({ "package.json": pkg("2.90.0") })), [{ status: "M", path: "package.json" }], new Set(["package.json"]), true)).toHaveLength(1);
  });

  it("refuses every hand bump", () => {
    const head = main({
      "package.json": pkg("2.90.0"),
      "package-lock.json": npmLock("2.90.0"),
      "CHANGELOG.md": "# Changelog\n\n## 2.90.0\n\n- New.\n\n## 2.89.1\n\n- Old.\n",
      "engine-rs/Cargo.toml": toml("1.23.0"),
      "engine-rs/Cargo.lock": cargoLock("1.23.0"),
      "engine-rs/consumer/Cargo.lock": cargoLock("1.23.0"),
      "engine-rs/CHANGELOG.md": "## 1.23.0 (2026-11-11)\n\n- New.\n\n## 1.22.0 (2026-11-10)\n",
      "engine-rs/src/compat-record.json": record("1.23.0"),
      ".changes/topic.md": note("minor", "minor"),
    });
    const errors = feature(main(), head);
    expect(errors).toHaveLength(9);
    for (const e of errors) expect(e).toMatch(/moved from .*release PR/);
  });

  it("leaves a merged PR's pending note alone on a reused branch", () => {
    const pending = main({ ".changes/topic.md": note("minor", "none") });
    const errors = feature(pending, { ...pending, "src/a.ts": "b", ".changes/topic.md": note("none", "none") });
    expect(errors).toEqual([
      ".changes/topic.md is a pending note main already has, from a merged PR: leave it to the release and add .changes/<branch-slug>-2.md for this PR.",
    ]);
    expect(feature(pending, { ...pending, "src/a.ts": "b", ".changes/topic-2.md": note("none", "none") })).toEqual([]);
  });

  it("keeps main's pending notes and reads its own", () => {
    const pending = main({ ".changes/other.md": note("minor", "none") });
    const gone = { ...pending, ".changes/topic.md": note("patch", "none"), "src/a.ts": "b" };
    delete (gone as Files)[".changes/other.md"];
    expect(feature(pending, gone)).toEqual([".changes/other.md was deleted: only a release PR consumes notes."]);
    expect(feature(main(), main({ "src/a.ts": "b", ".changes/topic.md": "app: minor\n" }))[0]).toMatch(/first line/);
  });

  it("needs its own crate level when a compatibility pin moves", () => {
    const moved = { "engine-rs/src/compat-record.json": record("1.22.0", "bbbb"), "src/a.ts": "b" };
    expect(feature(main(), main({ ...moved, ".changes/topic.md": note("none", "minor") }))).toEqual([]);
    expect(feature(main(), main({ ...moved, ".changes/topic.md": note("minor", "none") }))[0]).toMatch(/lockDigest moved.*declares no crate level/);
    // Another PR's pending crate note does not describe this one's change.
    const pending = main({ ".changes/other.md": note("none", "patch") });
    expect(feature(pending, { ...pending, ...moved, ".changes/topic.md": note("none", "none") })).toHaveLength(1);
  });
});

describe("a release PR", () => {
  const pending = main({ ".changes/a.md": note("patch", "none"), ".changes/b.md": note("minor", "patch") });
  const cut = (app: string, crate: string, extra: Files = {}): Files => {
    const out: Files = {
      ...main(),
      "package.json": pkg(app),
      "package-lock.json": npmLock(app),
      "CHANGELOG.md": `# Changelog\n\n## ${app}\n\n- New.\n\n## 2.89.1\n\n- Old.\n`,
      "engine-rs/Cargo.toml": toml(crate),
      "engine-rs/Cargo.lock": cargoLock(crate),
      "engine-rs/consumer/Cargo.lock": cargoLock(crate),
      "engine-rs/CHANGELOG.md": `## ${crate} (2026-11-11)\n\n- New.\n\n## 1.22.0 (2026-11-10)\n`,
      "engine-rs/src/compat-record.json": record(crate),
      ...extra,
    };
    return out;
  };

  it("passes when each version rises by its highest pending level and every note is consumed", () => {
    expect(release(pending, cut("2.90.0", "1.22.1"))).toEqual([]);
  });

  it("accepts a named later app version, and nothing lower or skipped", () => {
    expect(release(pending, cut("3.0.0", "1.22.1"))).toEqual([]);
    expect(release(pending, cut("2.89.2", "1.22.1"))[0]).toMatch(/app is 2\.89\.2.*\(minor\) is 2\.90\.0/);
    const noApp = main({ ".changes/a.md": note("none", "patch") });
    expect(release(noApp, cut("3.0.0", "1.22.1"))[0]).toMatch(/app is 3\.0\.0.*\(none\)/);
    // The crate takes exactly its level: a patch note cannot carry a minor release.
    expect(release(pending, cut("2.90.0", "1.23.0"))).toEqual(["crate is 1.23.0, but main's 1.22.0 raised by the highest pending crate level (patch) is 1.22.1."]);
  });

  it("refuses leftover notes, mismatched locks, a missing section and unrelated files", () => {
    expect(release(pending, cut("2.90.0", "1.22.1", { ".changes/b.md": note("minor", "patch") }))[0]).toMatch(/b\.md remain/);
    expect(release(pending, cut("2.90.0", "1.22.1", { "engine-rs/consumer/Cargo.lock": cargoLock("1.22.0") }))).toEqual([
      'engine-rs/consumer/Cargo.lock crate version is "1.22.0" and should be "1.22.1".',
    ]);
    expect(release(pending, cut("2.90.0", "1.22.1", { "CHANGELOG.md": main()["CHANGELOG.md"] }))).toEqual(["CHANGELOG.md has no 2.90.0 section at the top."]);
    expect(release(pending, cut("2.90.0", "1.22.1", { "src/a.ts": "b" }))).toEqual([
      "src/a.ts changed: a release PR changes only versions, changelogs and the notes it consumes.",
    ]);
  });

  it("refuses an edit inside a release file beyond its version", () => {
    const beyond = (path: string, edit: (t: string) => string) => {
      const head = cut("2.90.0", "1.22.1");
      return release(pending, { ...head, [path]: edit(head[path]) });
    };
    expect(beyond("package.json", (t) => JSON.stringify({ ...JSON.parse(t), scripts: { x: "y" } }))).toEqual([
      "package.json changed beyond its version: a release PR changes only the version there.",
    ]);
    expect(beyond("engine-rs/Cargo.toml", (t) => `${t}\n[dependencies]\nserde = "1"\n`)).toHaveLength(1);
    expect(beyond("engine-rs/Cargo.lock", (t) => `${t}\n[[package]]\nname = "serde"\n`)).toHaveLength(1);
    expect(beyond("engine-rs/src/compat-record.json", (t) => JSON.stringify({ ...JSON.parse(t), lockDigest: "bbbb" }))).toHaveLength(1);
    expect(beyond("package-lock.json", (t) => JSON.stringify({ ...JSON.parse(t), packages: { "": { name: "x", version: "2.90.0" }, "node_modules/a": {} } }))).toHaveLength(1);
    // The changelogs are the driver's to curate.
    expect(beyond("CHANGELOG.md", (t) => t.replace("- New.", "- Curated."))).toEqual([]);
  });

  it("refuses a release with nothing pending", () => {
    expect(release(main(), main())).toEqual(["main has no pending notes, so there is nothing to release."]);
  });
});
