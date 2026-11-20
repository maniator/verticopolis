import { describe, expect, it, vi } from "vitest";
import { MANUAL_COOKIE, manualCookie, manualHost, manualSavedFor, saveManualOffline } from "./manualOffline";

/** A document whose cookie line keeps what is written to it, the way a
 *  browser's does for one host (name=value pairs, attributes dropped). */
function cookieJar(initial = "") {
  const jar = new Map<string, string>();
  for (const part of initial.split(";").filter(Boolean)) {
    const [k, v] = part.trim().split("=");
    jar.set(k, v);
  }
  return {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(line: string) {
      const [pair] = line.split(";");
      const [k, v] = pair.split("=");
      jar.set(k, v);
    },
  };
}

function workers() {
  return { register: vi.fn(async () => ({})), ready: Promise.resolve({}) };
}

describe("manualCookie", () => {
  it("shares the manual host's mark with every verticopolis.com host", () => {
    expect(manualCookie("help.verticopolis.com")).toBe(
      `${MANUAL_COOKIE}=help.verticopolis.com; Domain=verticopolis.com; Path=/; Max-Age=34560000; SameSite=Lax; Secure`,
    );
  });

  it("keeps any other host's mark on that host", () => {
    expect(manualCookie("staging.verticopolis.com")).not.toContain("Domain=");
    expect(manualCookie("localhost:4173")).toMatch(/^vc_manual=localhost:4173; Path=\//);
  });
});

describe("manualSavedFor", () => {
  it("is true only for a mark naming the same host", () => {
    expect(manualSavedFor("a=1; vc_manual=help.verticopolis.com", "help.verticopolis.com")).toBe(true);
    expect(manualSavedFor("vc_manual=help.verticopolis.com", "staging.verticopolis.com")).toBe(false);
    expect(manualSavedFor("", "help.verticopolis.com")).toBe(false);
    expect(manualSavedFor("vc_manual_old=help.verticopolis.com", "help.verticopolis.com")).toBe(false);
  });

  it("finds a host's own mark beside the shared one", () => {
    const line = "vc_manual=help.verticopolis.com; vc_manual=staging.verticopolis.com";
    expect(manualSavedFor(line, "staging.verticopolis.com")).toBe(true);
  });
});

describe("manualHost", () => {
  it("is the manual's own host in a production build, else the game's", () => {
    expect(manualHost("https://help.verticopolis.com", "verticopolis.com")).toBe("help.verticopolis.com");
    expect(manualHost("", "staging.verticopolis.com")).toBe("staging.verticopolis.com");
    expect(manualHost("not a url", "localhost:4173")).toBe("localhost:4173");
  });
});

describe("saveManualOffline", () => {
  it("registers the worker at the base, marks the manual saved once a worker is ready, and counts the first save", async () => {
    const w = workers();
    const doc = cookieJar();
    const track = vi.fn();
    await saveManualOffline("/help", { workers: w, doc, host: "localhost:4173", track });
    expect(w.register).toHaveBeenCalledWith("/help/sw.js", { scope: "/help/" });
    expect(manualSavedFor(doc.cookie, "localhost:4173")).toBe(true);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("registers at the root of the manual's own host", async () => {
    const w = workers();
    await saveManualOffline("", { workers: w, doc: cookieJar(), host: "help.verticopolis.com", track: () => {} });
    expect(w.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("refreshes the mark on a later page without counting again", async () => {
    const doc = cookieJar("vc_manual=help.verticopolis.com");
    const track = vi.fn();
    await saveManualOffline("", { workers: workers(), doc, host: "help.verticopolis.com", track });
    expect(track).not.toHaveBeenCalled();
  });

  it("does not count a save the browser's cookies refused", async () => {
    const doc = { cookie: "" };
    Object.defineProperty(doc, "cookie", { get: () => "", set: () => {} });
    const track = vi.fn();
    await saveManualOffline("", { workers: workers(), doc, host: "help.verticopolis.com", track });
    expect(track).not.toHaveBeenCalled();
  });

  it("marks nothing when there are no workers or the register fails", async () => {
    const doc = cookieJar();
    await saveManualOffline("", { workers: null, doc, host: "h", track: () => {} });
    const refused = {
      register: vi.fn(async () => Promise.reject(new DOMException("no", "SecurityError"))),
      ready: new Promise(() => {}),
    };
    await expect(saveManualOffline("", { workers: refused, doc, host: "h", track: () => {} })).resolves.toBeUndefined();
    expect(doc.cookie).toBe("");
  });
});
