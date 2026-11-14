import { describe, it, expect, vi, afterEach } from "vitest";
import { ModalPrecedence, routeNotice } from "./modalPrecedence";

/** A shared dialog with a body, open, as the UI mounts one. */
function openDialog(): { dialog: HTMLDialogElement; box: HTMLElement } {
  const dialog = document.createElement("dialog");
  const box = document.createElement("div");
  box.className = "modal-box";
  const title = document.createElement("h2");
  title.textContent = "Elevator schedule";
  box.append(title);
  dialog.append(box);
  document.body.append(dialog);
  dialog.open = true;
  return { dialog, box };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("routeNotice", () => {
  it("mounts the line under the dialog's title, and a second ask rebuilds it", () => {
    const { dialog, box } = openDialog();
    const toast = vi.fn();
    routeNotice(dialog, new ModalPrecedence(), "Hello", toast);
    const first = box.querySelector(".modal-notice");
    expect(first?.textContent).toBe("Hello");
    expect(box.querySelector("h2")?.nextElementSibling).toBe(first);
    routeNotice(dialog, new ModalPrecedence(), "Hello", toast);
    const second = box.querySelector(".modal-notice");
    expect(second).not.toBe(first);
    expect(box.querySelectorAll(".modal-notice")).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("leaves a line the dialog already shows alone when asked not to say it again (#1121)", () => {
    const { dialog, box } = openDialog();
    const precedence = new ModalPrecedence();
    routeNotice(dialog, precedence, "Waiting", vi.fn(), false);
    const first = box.querySelector(".modal-notice");
    expect(first?.getAttribute("role")).toBe("alert");
    routeNotice(dialog, precedence, "Waiting", vi.fn(), false);
    expect(box.querySelector(".modal-notice")).toBe(first);
  });

  it("leaves a different line alone when asked not to say this one again, so a failure is still read", () => {
    const { dialog, box } = openDialog();
    routeNotice(dialog, new ModalPrecedence(), "Import dropped", vi.fn());
    routeNotice(dialog, new ModalPrecedence(), "Waiting", vi.fn(), false);
    expect([...box.querySelectorAll(".modal-notice")].map((n) => n.textContent)).toEqual(["Import dropped"]);
  });

  it("still replaces a different line on a plain ask", () => {
    const { dialog, box } = openDialog();
    routeNotice(dialog, new ModalPrecedence(), "Import dropped", vi.fn());
    routeNotice(dialog, new ModalPrecedence(), "Saved", vi.fn());
    expect([...box.querySelectorAll(".modal-notice")].map((n) => n.textContent)).toEqual(["Saved"]);
  });

  it("toasts when no dialog is open", () => {
    const { dialog } = openDialog();
    dialog.open = false;
    const toast = vi.fn();
    routeNotice(dialog, new ModalPrecedence(), "Saved", toast, false);
    expect(toast).toHaveBeenCalledExactlyOnceWith("Saved");
  });

  it("holds the line for the next body when the dialog is mid-replace", () => {
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    dialog.open = true;
    const precedence = new ModalPrecedence();
    routeNotice(dialog, precedence, "Later", vi.fn());
    const next = document.createElement("div");
    precedence.drainNotice(next);
    expect(next.querySelector(".modal-notice")?.textContent).toBe("Later");
  });

  it("holds nothing for the next body when asked not to say it again, since that body may be the dialog it waited for", () => {
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    dialog.open = true;
    const precedence = new ModalPrecedence();
    routeNotice(dialog, precedence, "Waiting", vi.fn(), false);
    const next = document.createElement("div");
    precedence.drainNotice(next);
    expect(next.querySelector(".modal-notice")).toBeNull();
  });
});
