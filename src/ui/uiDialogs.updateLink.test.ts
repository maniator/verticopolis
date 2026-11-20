import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TemplateResult } from "lit-html";
import type { UI } from "./UI";
import { renderToFragment } from "./testing/litTestUtils";

// The controller's one decision about the release notes link: a browser tab
// shows it, the installed app does not (a new tab would leave the app).
const standalone = vi.hoisted(() => ({ isInstalledStandalone: vi.fn(() => false) }));
vi.mock("./standalone", () => standalone);

import { showUpdatePrompt } from "./uiDialogs";

function fakeUI(): { ui: UI; openModal: ReturnType<typeof vi.fn> } {
  const openModal = vi.fn((_t: TemplateResult) => document.createElement("div"));
  const ui = {
    el: { modal: document.createElement("dialog") },
    openModal,
    closeModal: vi.fn(),
  } as unknown as UI;
  return { ui, openModal };
}

function shownLink(openModal: ReturnType<typeof vi.fn>): HTMLAnchorElement | null {
  const template = openModal.mock.calls[0][0] as TemplateResult;
  return renderToFragment(template).querySelector('a[data-act="release-notes"]');
}

const info = { version: "3.2.0", sha: "abc1234", notes: ["A change."] };

describe("showUpdatePrompt release notes link", () => {
  beforeEach(() => standalone.isInstalledStandalone.mockReset());

  it("shows the link in a browser tab", () => {
    standalone.isInstalledStandalone.mockReturnValue(false);
    const { ui, openModal } = fakeUI();
    showUpdatePrompt(
      ui,
      () => {},
      () => {},
      info,
    );
    expect(standalone.isInstalledStandalone).toHaveBeenCalled();
    expect(shownLink(openModal)?.getAttribute("href")).toBe("/help/changelog?from=game&via=update_prompt#3.2.0");
  });

  it("leaves it out in the installed app", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    const { ui, openModal } = fakeUI();
    showUpdatePrompt(
      ui,
      () => {},
      () => {},
      info,
    );
    expect(shownLink(openModal)).toBeNull();
  });
});
