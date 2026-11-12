import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  WELCOME_MARKER,
  WELCOME_MESSAGES,
  renderWelcome,
  welcomeFirstContribution,
  type ContributionEvent,
  type WelcomePort,
} from "./firstContribution";

const root = resolve(__dirname, "..", "..");
const TEMPLATE = `${WELCOME_MARKER}\nThanks @{login}! See https://github.com/{repo}/blob/main/CONTRIBUTING.md`;

const event = (over: Partial<ContributionEvent> = {}): ContributionEvent => ({
  kind: "pull request",
  number: 2017,
  author: "newcomer",
  authorType: "User",
  association: "FIRST_TIME_CONTRIBUTOR",
  repo: "owner/game",
  ...over,
});

function port(
  answers: { numbers?: number[]; comments?: string[]; template?: string } = {},
) {
  return {
    listAuthorNumbers: vi.fn<WelcomePort["listAuthorNumbers"]>(
      () => answers.numbers ?? [2017],
    ),
    readMessage: vi.fn<WelcomePort["readMessage"]>(
      () => answers.template ?? TEMPLATE,
    ),
    listCommentBodies: vi.fn<WelcomePort["listCommentBodies"]>(
      () => answers.comments ?? [],
    ),
    postComment: vi.fn<WelcomePort["postComment"]>(),
  };
}

describe("welcomeFirstContribution", () => {
  it("posts the pull request message with the login and repository filled in", () => {
    const p = port();
    const outcome = welcomeFirstContribution(event(), p);
    expect(outcome.posted).toBe(true);
    expect(p.listAuthorNumbers).toHaveBeenCalledWith(
      "pull request",
      "newcomer",
    );
    expect(p.readMessage).toHaveBeenCalledWith(".github/welcome/first-pr.md");
    expect(p.listCommentBodies).toHaveBeenCalledWith(2017);
    expect(p.postComment).toHaveBeenCalledWith(
      2017,
      `${WELCOME_MARKER}\nThanks @newcomer! See https://github.com/owner/game/blob/main/CONTRIBUTING.md`,
    );
  });

  it("uses the issue message and counts only issues for an issue", () => {
    const p = port({ numbers: [40] });
    expect(
      welcomeFirstContribution(event({ kind: "issue", number: 40 }), p).posted,
    ).toBe(true);
    expect(p.listAuthorNumbers).toHaveBeenCalledWith("issue", "newcomer");
    expect(p.readMessage).toHaveBeenCalledWith(
      ".github/welcome/first-issue.md",
    );
    expect(p.postComment).toHaveBeenCalledWith(
      40,
      expect.stringContaining("@newcomer"),
    );
  });

  it.each(["OWNER", "MEMBER", "COLLABORATOR"])(
    "never welcomes an author who is %s, and looks nothing up",
    (association) => {
      const p = port();
      const outcome = welcomeFirstContribution(event({ association }), p);
      expect(outcome).toEqual({
        posted: false,
        reason: `newcomer is ${association}`,
      });
      expect(p.listAuthorNumbers).not.toHaveBeenCalled();
      expect(p.postComment).not.toHaveBeenCalled();
    },
  );

  it("never welcomes a bot, by user type or by the [bot] suffix", () => {
    for (const bot of [
      event({ authorType: "Bot", author: "copilot" }),
      event({ author: "dependabot[bot]" }),
    ]) {
      const p = port();
      expect(welcomeFirstContribution(bot, p).reason).toBe(
        `${bot.author} is a bot`,
      );
      expect(p.listAuthorNumbers).not.toHaveBeenCalled();
      expect(p.postComment).not.toHaveBeenCalled();
    }
  });

  it("refuses a login GitHub could not have issued before it reaches a query", () => {
    for (const author of [
      "a&state=open",
      "-lead",
      "trail-",
      "dou--ble",
      "x".repeat(40),
    ]) {
      const p = port();
      expect(
        welcomeFirstContribution(event({ author }), p).posted,
        author,
      ).toBe(false);
      expect(p.listAuthorNumbers, author).not.toHaveBeenCalled();
    }
  });

  it("skips an author with an earlier pull request, open or closed", () => {
    const p = port({ numbers: [1500, 2017] });
    expect(welcomeFirstContribution(event(), p)).toEqual({
      posted: false,
      reason: "newcomer has 1 earlier pull request(s) here",
    });
    expect(p.readMessage).not.toHaveBeenCalled();
    expect(p.postComment).not.toHaveBeenCalled();
  });

  it("still welcomes the first of two opened at once, and only that one", () => {
    const first = port({ numbers: [2017, 2018] });
    expect(
      welcomeFirstContribution(event({ number: 2017 }), first).posted,
    ).toBe(true);
    const second = port({ numbers: [2017, 2018] });
    expect(
      welcomeFirstContribution(event({ number: 2018 }), second).posted,
    ).toBe(false);
    expect(second.postComment).not.toHaveBeenCalled();
  });

  it("welcomes when the list has not caught up with the new item yet", () => {
    const p = port({ numbers: [] });
    expect(welcomeFirstContribution(event(), p).posted).toBe(true);
  });

  it("never welcomes a thread twice", () => {
    const p = port({
      comments: ["Nice work!", `${WELCOME_MARKER}\r\nThanks @newcomer!`],
    });
    expect(welcomeFirstContribution(event(), p)).toEqual({
      posted: false,
      reason: "#2017 already has the welcome",
    });
    expect(p.postComment).not.toHaveBeenCalled();
  });

  it("does not take a mention of the marker inside other text for the welcome", () => {
    const p = port({
      comments: [`The \`${WELCOME_MARKER}\` line marks the welcome.`],
    });
    expect(welcomeFirstContribution(event(), p).posted).toBe(true);
  });

  it("refuses a message file that lost its marker, so it cannot post twice", () => {
    const p = port({ template: "Thanks @{login}!" });
    expect(() => welcomeFirstContribution(event(), p)).toThrow(
      /must start with/,
    );
    expect(p.postComment).not.toHaveBeenCalled();
  });
});

describe("renderWelcome", () => {
  it("fills every placeholder and leaves other text alone", () => {
    expect(renderWelcome("{login} {login} {repo} {other}", "a-b", "o/r")).toBe(
      "a-b a-b o/r {other}",
    );
  });
});

/** The labels `.github/labels.yml` defines. */
const labels = new Set(
  [
    ...readFileSync(resolve(root, ".github/labels.yml"), "utf8").matchAll(
      /^\s*- name:\s*"?([^"\n]+?)"?\s*$/gm,
    ),
  ].map((m) => m[1]),
);

describe.each(Object.entries(WELCOME_MESSAGES))(
  "the %s welcome as posted",
  (kind, path) => {
    const posted = renderWelcome(
      readFileSync(resolve(root, path), "utf8"),
      "newcomer",
      "maniator/verticopolis",
    );
    const links = [...posted.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(
      (m) => m[1],
    );

    it("starts with the marker and greets the author", () => {
      expect(posted.split("\n")[0]).toBe(WELCOME_MARKER);
      expect(posted).toContain("@newcomer");
      expect(posted).not.toMatch(/\{(login|repo)\}/);
    });

    it("links CONTRIBUTING.md and the good first issue and help wanted lists", () => {
      expect(links).toContain(
        "https://github.com/maniator/verticopolis/blob/main/CONTRIBUTING.md",
      );
      const linked = links.flatMap((link) => {
        const m = /label%3A%22(.+?)%22/.exec(link);
        return m ? [decodeURIComponent(m[1].split("+").join(" "))] : [];
      });
      expect(linked).toEqual(["good first issue", "help wanted"]);
    });

    it("links only files and labels that exist", () => {
      for (const link of links) {
        expect(
          link.startsWith("https://github.com/maniator/verticopolis/"),
          link,
        ).toBe(true);
        const blob = /\/blob\/main\/(.+)$/.exec(link);
        if (blob) expect(existsSync(resolve(root, blob[1])), link).toBe(true);
        const label = /label%3A%22(.+?)%22/.exec(link);
        if (label)
          expect(
            labels.has(decodeURIComponent(label[1].split("+").join(" "))),
            link,
          ).toBe(true);
        expect(blob || label, `${kind}: ${link}`).toBeTruthy();
      }
    });

    it("uses no em-dash", () => {
      expect(posted).not.toContain("—");
    });
  },
);
