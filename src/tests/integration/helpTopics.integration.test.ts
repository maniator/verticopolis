// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { html, render } from "lit-html";
import { mountAppDom, makeUI } from "../uiFixture";
import { helpTopicLink } from "../../ui/templates/helpTopicLink";

/**
 * The problem lines' Help links (#2036) on the real UI, with the game's
 * callbacks as spies: a press on one in the room card or Tower Statistics
 * opens its manual page in a new tab and holds the pause until the player is
 * back, and F1 opens the hover card's first one (its pointer goes through
 * the card), or the guide with no card up.
 */

const sent = vi.hoisted(() => ({ trackAppAction: vi.fn() }));
vi.mock("../../analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics")>()),
  trackAppAction: sent.trackAppAction,
}));

/** A speed the controller reads back after it sets it, as the game's does. */
function speedAt(start: number) {
  let speed = start;
  return { onSpeed: vi.fn((s: number) => (speed = s)), getSpeed: () => speed, now: () => speed };
}

function leaveAndReturn(): void {
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  focus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  focus.mockRestore();
}

/** Show a room card holding a parking line and a noise line. */
function showCard(): HTMLElement {
  const card = document.getElementById("inspector")!;
  render(
    [
      html`<div>Main gripe: too little parking.${helpTopicLink("parking", "inspector")}</div>`,
      html`<div>Won't lease: a noisy neighbor.${helpTopicLink("noise", "inspector")}</div>`,
    ],
    card,
  );
  card.classList.remove("hidden");
  return card;
}

const pressF1 = (opts: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: "F1", cancelable: true, ...opts });
  window.dispatchEvent(e);
  return e;
};

describe("the problem lines' Help links", () => {
  beforeEach(() => {
    mountAppDom();
    sent.trackAppAction.mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the line's page in a new tab, pauses the tower and resumes once the player is back", () => {
    const speed = speedAt(2);
    makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const link = showCard().querySelector<HTMLAnchorElement>('a[data-help-topic="noise"]')!;
    const press = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      "/help/tower/ratings/?from=game&via=inspector#what-wears-a-rating-down",
      "_blank",
    );
    expect(sent.trackAppAction).toHaveBeenCalledWith("help_topic_open", "inspector_noise");
    expect(speed.now()).toBe(0);
    leaveAndReturn();
    expect(speed.now()).toBe(2);
  });

  it("names Tower Statistics as the surface for a link in the dialog", () => {
    makeUI();
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const modal = document.getElementById("modal")!;
    render(html`<span>0 / 2 working${helpTopicLink("parking", "stats")}</span>`, modal);
    modal.querySelector<HTMLAnchorElement>("a.help-topic")!.click();
    expect(sent.trackAppAction).toHaveBeenCalledWith("help_topic_open", "stats_parking");
  });

  it("says where the manual is when offline, opens no tab and keeps the tower running", () => {
    const speed = speedAt(3);
    const { ui } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const open = vi.spyOn(window, "open");
    const say = vi.spyOn(ui, "sayVisibly");
    showCard().querySelector<HTMLAnchorElement>("a.help-topic")!.click();
    expect(open).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(
      "The manual needs the internet the first time. Open it once while online and it works offline after that. It is at help.verticopolis.com.",
    );
    expect(speed.now()).toBe(3);
  });

  it("says where the manual is when the browser blocks the tab, and keeps the tower running", () => {
    const speed = speedAt(3);
    const { ui } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    vi.spyOn(window, "open").mockReturnValue(null);
    const say = vi.spyOn(ui, "sayVisibly");
    showCard().querySelector<HTMLAnchorElement>("a.help-topic")!.click();
    expect(say).toHaveBeenCalledWith("The manual could not open. It is at help.verticopolis.com.");
    expect(speed.now()).toBe(3);
  });

  it("opens one tab however many times the UI was made", () => {
    makeUI();
    mountAppDom();
    makeUI();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    showCard().querySelector<HTMLAnchorElement>("a.help-topic")!.click();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens the hover card's first link on F1", () => {
    makeUI();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    showCard();
    expect(pressF1().defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("/help/rooms/services/?from=game&via=inspector#parking", "_blank");
    expect(sent.trackAppAction).toHaveBeenCalledWith("help_topic_open", "inspector_parking");
  });

  it("opens the guide on F1 with no card up, or a hidden one", () => {
    makeUI();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    showCard().classList.add("hidden");
    pressF1();
    expect(open).toHaveBeenCalledWith("/help/?from=game&via=help_key", "_blank");
    expect(sent.trackAppAction).toHaveBeenCalledWith("help_open", "help_key");
  });

  it("marks a room card that holds a Help link, so the desktop card names F1", () => {
    const { ui } = makeUI();
    const card = document.getElementById("inspector")!;
    ui.showInspector(
      html`<h4 class="win-title">Office</h4><div>Main gripe: noise.${helpTopicLink("noise", "inspector")}</div>`,
    );
    expect(card.classList.contains("has-help")).toBe(true);
    ui.showInspector(html`<h4 class="win-title">Office</h4><div>Access: reachable from the lobby.</div>`);
    expect(card.classList.contains("has-help")).toBe(false);
  });

  it("leaves F1 alone with a dialog open, with a modifier, or held down", () => {
    makeUI();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    showCard();
    expect(pressF1({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(pressF1({ repeat: true }).defaultPrevented).toBe(false);
    (document.getElementById("modal") as HTMLDialogElement).showModal();
    expect(pressF1().defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
