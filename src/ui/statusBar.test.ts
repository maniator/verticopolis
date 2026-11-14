import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showNewsInStatusBar, showTowerInStatusBar } from "./statusBar";

beforeEach(() => {
  document.body.innerHTML = `<span id="sb-tower"></span><span id="sb-news"></span>`;
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("status bar", () => {
  it("names the tower and its rules, and leaves the box alone when nothing changed", () => {
    const cell = document.getElementById("sb-tower")!;
    showTowerInStatusBar("Skyspire", "modern");
    expect(cell.textContent).toBe("Skyspire · Modern");
    const node = cell.firstChild;
    showTowerInStatusBar("Skyspire", "modern");
    expect(cell.firstChild).toBe(node); // no rewrite on an unchanged pass
    showTowerInStatusBar("Skyspire", "classic");
    expect(cell.textContent).toBe("Skyspire · Classic");
  });

  it("shows the newest bulletin line with its title, and clears on empty", () => {
    const cell = document.getElementById("sb-news")!;
    showNewsInStatusBar("Rent is due");
    expect(cell.textContent).toContain("Rent is due");
    expect(cell.title).toBe("Rent is due");
    showNewsInStatusBar("");
    expect(cell.textContent).toBe("");
  });

  it("speaks the newest line while the Bulletin window is closed, and leaves it to the window's log or a toast otherwise", () => {
    document.body.innerHTML += `<div id="sb-news-live"></div><div id="bulletin-win" hidden></div>`;
    const live = document.getElementById("sb-news-live")!;
    showNewsInStatusBar("Rent is due");
    expect(live.textContent).toBe("Rent is due");
    showNewsInStatusBar("A toast said this", document, false);
    expect(live.textContent).toBe("Rent is due");
    document.getElementById("bulletin-win")!.hidden = false;
    showNewsInStatusBar("The window says this");
    expect(live.textContent).toBe("Rent is due");
    expect(document.getElementById("sb-news")!.textContent).toBe("The window says this");
  });

  it("does nothing on a page without the bar", () => {
    document.body.innerHTML = "";
    expect(() => {
      showTowerInStatusBar("T", "classic");
      showNewsInStatusBar("x");
    }).not.toThrow();
  });
});
