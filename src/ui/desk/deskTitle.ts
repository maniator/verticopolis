import { trackAppAction, trackAppActionOnce } from "../../analyticsActions";
import { DESK_TITLE_WINDOW, trackDeskStartOpen, trackDeskTask, trackDeskTray } from "./deskAnalytics";
import { DeskTaskbar } from "./deskTaskbar";

/**
 * The title screen on the 1994 desk (owner's pick, 2026-11-15: the sunrise,
 * then the desk with the Welcome window). While the title screen is up on a
 * computer, the desk shows its teal and its taskbar, and the title screen sits
 * in a Verticopolis window: its dusk poster on top, its buttons in a gray bar
 * below (styles/game/desk-title.css). The title screen itself is unchanged;
 * this adds the window's title bar and the taskbar around it.
 *
 * Cost: built once when the title screen comes up on a computer and removed
 * when it goes. Nothing runs per frame; the tray clock ticks once a minute.
 */

/** The class <body> wears while the title screen sits on the desk. */
export const DESK_TITLE_CLASS = "desk-title";

export class DeskTitle {
  private bar: HTMLElement | null = null;
  private taskbar: DeskTaskbar | null = null;

  constructor(private readonly doc: Document) {}

  get up(): boolean {
    return !!this.bar;
  }

  show(): void {
    if (this.bar) return;
    const doc = this.doc;
    doc.body.classList.add(DESK_TITLE_CLASS);
    const bar = doc.createElement("div");
    bar.className = "desk-title-bar";
    bar.setAttribute("aria-hidden", "true");
    const icon = doc.createElement("img");
    icon.src = "./favicon.png";
    icon.alt = "";
    icon.width = 16;
    icon.height = 16;
    const text = doc.createElement("span");
    text.textContent = "Verticopolis";
    bar.append(icon, text);
    doc.body.appendChild(bar);
    this.bar = bar;

    const taskbar = new DeskTaskbar(doc, {
      // The title screen's window is the only one, and it stays up.
      task: () => {
        trackDeskTask(DESK_TITLE_WINDOW, "front");
        doc.querySelector<HTMLElement>("#splash .splash-btn.primary")?.focus();
      },
      start: (itemId) => {
        trackAppAction("desk_start", itemId);
        doc.getElementById(itemId)?.click();
      },
      opened: () => trackDeskStartOpen("title"),
      tray: trackDeskTray,
    });
    taskbar.root.classList.add("desk-taskbar-title");
    doc.body.appendChild(taskbar.root);
    taskbar.start();
    taskbar.render([{ id: DESK_TITLE_WINDOW, label: "Verticopolis", active: true, minimized: false }]);
    taskbar.syncSound();
    this.taskbar = taskbar;
    trackAppActionOnce("desk_title_shown");
  }

  hide(): void {
    if (!this.bar) return;
    this.doc.body.classList.remove(DESK_TITLE_CLASS);
    this.bar.remove();
    this.bar = null;
    this.taskbar?.stop();
    this.taskbar?.root.remove();
    this.taskbar = null;
  }
}
