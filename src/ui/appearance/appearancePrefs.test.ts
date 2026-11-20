import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_SCHEME,
  SCHEME_ATTRIBUTE,
  SCHEME_COOKIE,
  applyScheme,
  loadScheme,
  saveScheme,
  schemeCookie,
  shareScheme,
} from "./appearancePrefs";

const store = (raw: string | null) => ({ getItem: vi.fn(() => raw) });

describe("appearance prefs", () => {
  it("start every player on Standard", () => {
    expect(DEFAULT_SCHEME).toBe("standard");
    expect(loadScheme(store(null))).toBe("standard");
  });

  it("read back the kept scheme", () => {
    const s = store("skyline");
    expect(loadScheme(s)).toBe("skyline");
    expect(s.getItem).toHaveBeenCalledWith("vc.appearance");
    expect(loadScheme(store("high_contrast"))).toBe("high_contrast");
  });

  it("keep Standard for anything that is not a scheme the dialog offers", () => {
    expect(loadScheme(store("luna"))).toBe("standard");
    expect(loadScheme(store(""))).toBe("standard");
  });

  it("fall back to Standard on blocked or missing storage", () => {
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    expect(loadScheme(throwing)).toBe("standard");
    expect(loadScheme(null)).toBe("standard");
  });

  it("save the scheme's id, and a full storage does not throw", () => {
    const s = { setItem: vi.fn() };
    saveScheme("skyline", s);
    expect(s.setItem).toHaveBeenCalledWith("vc.appearance", "skyline");
    const full = {
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    expect(() => saveScheme("standard", full)).not.toThrow();
  });

  it("put the scheme on the root element, and Standard takes the attribute off", () => {
    const root = document.createElement("html");
    applyScheme("skyline", root);
    expect(root.getAttribute(SCHEME_ATTRIBUTE)).toBe("skyline");
    applyScheme("high_contrast", root);
    expect(root.getAttribute(SCHEME_ATTRIBUTE)).toBe("high_contrast");
    applyScheme("standard", root);
    expect(root.hasAttribute(SCHEME_ATTRIBUTE)).toBe(false);
  });

  it("share the scheme in a first-party cookie that holds only its name", () => {
    expect(schemeCookie("skyline")).toBe(
      `${SCHEME_COOKIE}=skyline; Domain=verticopolis.com; Path=/; Max-Age=34560000; SameSite=Lax; Secure`,
    );
  });

  it("write the cookie on the production hosts only, and blocked cookies do not throw", () => {
    const doc = { cookie: "" };
    shareScheme("high_contrast", "verticopolis.com", doc);
    expect(doc.cookie).toBe(schemeCookie("high_contrast"));
    shareScheme("standard", "www.verticopolis.com", doc);
    expect(doc.cookie).toBe(schemeCookie("standard"));
    for (const host of ["staging.verticopolis.com", "verticopolis-git-x.vercel.app", "localhost"]) {
      const other = { cookie: "" };
      shareScheme("skyline", host, other);
      expect(other.cookie).toBe("");
    }
    const blocked = {
      set cookie(_v: string) {
        throw new Error("blocked");
      },
      get cookie() {
        return "";
      },
    };
    expect(() => shareScheme("skyline", "verticopolis.com", blocked)).not.toThrow();
  });
});
