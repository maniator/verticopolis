import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../analyticsActions", () => ({ trackAppActionOnce: vi.fn() }));

import { trackAppActionOnce } from "../analyticsActions";
import { makeUI, mountAppDom } from "../tests/uiFixture";
import { wireBulletinReadBack } from "./bulletinReadBack";

/** A log element whose scroll offset the test sets, then scrolls. */
function scrolledLog(): { log: HTMLElement; scrollTo: (top: number) => void } {
  const log = document.createElement("div");
  return {
    log,
    scrollTo: (top) => {
      log.scrollTop = top;
      log.dispatchEvent(new Event("scroll"));
    },
  };
}

beforeEach(() => vi.mocked(trackAppActionOnce).mockClear());

describe("the Bulletin read-back report", () => {
  it("sends bulletin_read_back when the player scrolls down from the newest line", () => {
    const { log, scrollTo } = scrolledLog();
    wireBulletinReadBack(log);
    scrollTo(40);
    expect(trackAppActionOnce).toHaveBeenCalledExactlyOnceWith("bulletin_read_back");
  });

  it("sends nothing while the Bulletin sits on its newest line", () => {
    const { log, scrollTo } = scrolledLog();
    wireBulletinReadBack(log);
    scrollTo(0);
    expect(trackAppActionOnce).not.toHaveBeenCalled();
  });

  it("stops listening after the one report", () => {
    const { log, scrollTo } = scrolledLog();
    wireBulletinReadBack(log);
    scrollTo(40);
    scrollTo(0);
    scrollTo(80);
    expect(trackAppActionOnce).toHaveBeenCalledTimes(1);
  });

  it("is wired on the game's own Bulletin", () => {
    mountAppDom();
    const { ui } = makeUI();
    ui.el.log.scrollTop = 40;
    ui.el.log.dispatchEvent(new Event("scroll"));
    expect(trackAppActionOnce).toHaveBeenCalledExactlyOnceWith("bulletin_read_back");
  });
});
