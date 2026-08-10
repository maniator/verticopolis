import { afterEach, describe, expect, it } from "vitest";
import {
  DEBUG_SECTIONS,
  DEBUG_STORAGE_KEY,
  clearStoredSpec,
  anyDebugOn,
  isDebugSection,
  loadDebugFlags,
  noDebugFlags,
  parseDebugTokens,
  readStoredSpec,
  resolveDebugFlags,
  serializeDebugFlags,
  writeStoredSpec,
} from "./debugFlags";

afterEach(() => {
  localStorage.clear();
});

describe("parseDebugTokens", () => {
  it("defaults a valueless spec to the metrics HUD", () => {
    expect(parseDebugTokens("")).toEqual({ hud: true, draw: [], filter: null, unknown: [], off: false });
    // Whitespace and stray commas are the same as nothing at all.
    expect(parseDebugTokens("  , ,")).toEqual({ hud: true, draw: [], filter: null, unknown: [], off: false });
  });

  it("reads fps and hud as the same token", () => {
    expect(parseDebugTokens("fps").hud).toBe(true);
    expect(parseDebugTokens("hud").hud).toBe(true);
  });

  it("turns bare draw into every section", () => {
    expect(parseDebugTokens("draw").draw).toEqual([...DEBUG_SECTIONS]);
  });

  it("scopes draw to one named section", () => {
    expect(parseDebugTokens("draw:graphics").draw).toEqual(["graphics"]);
    expect(parseDebugTokens("draw:collider,draw:motion").draw).toEqual(["collider", "motion"]);
  });

  it("emits sections in DEBUG_SECTIONS order regardless of how they were typed", () => {
    // Order stability matters: the persisted spec round-trips through here, so
    // an insertion-ordered array would make the same request serialize two ways.
    expect(parseDebugTokens("draw:motion,draw:entity").draw).toEqual(["entity", "motion"]);
  });

  it("dedupes a section named twice", () => {
    expect(parseDebugTokens("draw:graphics,draw:graphics").draw).toEqual(["graphics"]);
  });

  it("preserves case in a filter value but not in the token key", () => {
    // Actor names are camelCase (`garageCar`), so lowercasing the value would
    // make the filter silently match nothing.
    expect(parseDebugTokens("FILTER:garageCar").filter).toBe("garageCar");
  });

  it("splits a filter on the first colon only", () => {
    expect(parseDebugTokens("filter:a:b").filter).toBe("a:b");
  });

  it("treats an empty filter value as no filter", () => {
    expect(parseDebugTokens("filter:").filter).toBeNull();
  });

  it("turns everything on for all", () => {
    const flags = parseDebugTokens("all");
    expect(flags.hud).toBe(true);
    expect(flags.draw).toEqual([...DEBUG_SECTIONS]);
  });

  it("lets off win over every other token in the spec", () => {
    expect(parseDebugTokens("fps,draw,off")).toEqual({ ...noDebugFlags(), off: true });
    expect(parseDebugTokens("off,fps")).toEqual({ ...noDebugFlags(), off: true });
  });

  it("collects unknown tokens instead of throwing", () => {
    const flags = parseDebugTokens("fps,wat,draw:nope");
    expect(flags.hud).toBe(true);
    expect(flags.unknown).toEqual(["wat", "draw:nope"]);
  });
});

describe("isDebugSection", () => {
  it("accepts a known section and rejects anything else", () => {
    expect(isDebugSection("graphics")).toBe(true);
    // Excalibur has an `isometric` section; nothing here renders one, so it is
    // deliberately outside this vocabulary.
    expect(isDebugSection("isometric")).toBe(false);
    expect(isDebugSection("")).toBe(false);
  });
});

describe("resolveDebugFlags", () => {
  it("lets the URL parameter win over a stored spec", () => {
    const { flags } = resolveDebugFlags("?debug=draw:camera", "fps");
    expect(flags.hud).toBe(false);
    expect(flags.draw).toEqual(["camera"]);
  });

  it("falls back to the stored spec when the URL carries no parameter", () => {
    const { flags, clearStored } = resolveDebugFlags("?src=twa", "fps");
    expect(flags.hud).toBe(true);
    expect(clearStored).toBe(false);
  });

  it("resolves to nothing when neither source asks for anything", () => {
    expect(resolveDebugFlags("", null)).toEqual({ flags: noDebugFlags(), clearStored: false });
  });

  it("treats a bare ?debug as the HUD", () => {
    expect(resolveDebugFlags("?debug", null).flags.hud).toBe(true);
  });

  it("asks for the store to be cleared on ?debug=off", () => {
    const { flags, clearStored } = resolveDebugFlags("?debug=off", "fps,draw");
    expect(flags).toEqual({ ...noDebugFlags(), off: true });
    expect(clearStored).toBe(true);
  });

  it("does not clear the store for a merely unrecognized spec", () => {
    // A typo must not silently destroy the spec you saved on purpose.
    const { clearStored } = resolveDebugFlags("?debug=wat", "fps");
    expect(clearStored).toBe(false);
  });

  it("does not clear the store for a recognized spec that turns nothing on", () => {
    // Regression: `clearStored` used to be inferred from "nothing is on", but
    // `filter:` is a recognized token that deliberately sets nothing. Reloading
    // with `?debug=filter:` to drop a filter silently deleted the whole
    // persisted spec. Only an explicit `off` may do that.
    for (const spec of ["filter:", "filter:,", "  filter:  "]) {
      const { flags, clearStored } = resolveDebugFlags(`?debug=${spec}`, "fps,draw:motion");
      expect(flags.filter).toBeNull();
      expect(clearStored).toBe(false);
    }
  });
});

describe("serializeDebugFlags", () => {
  it("round-trips through parseDebugTokens", () => {
    for (const spec of ["fps", "draw", "fps,draw", "draw:graphics", "fps,draw:motion,filter:person"]) {
      expect(serializeDebugFlags(parseDebugTokens(spec))).toBe(spec);
    }
  });

  it("collapses a full section list back to the bare draw token", () => {
    expect(serializeDebugFlags({ hud: false, draw: [...DEBUG_SECTIONS], filter: null, unknown: [], off: false })).toBe("draw");
  });

  it("drops unknown tokens rather than carrying them forward", () => {
    expect(serializeDebugFlags({ hud: true, draw: [], filter: null, unknown: ["wat"], off: false })).toBe("fps");
  });

  it("serializes nothing-on to an empty spec", () => {
    expect(serializeDebugFlags(noDebugFlags())).toBe("");
  });
});

describe("storage helpers", () => {
  it("writes, reads, and clears a spec", () => {
    writeStoredSpec("fps,draw");
    expect(readStoredSpec()).toBe("fps,draw");
    clearStoredSpec();
    expect(readStoredSpec()).toBeNull();
  });

  it("stores an empty spec as a removal", () => {
    writeStoredSpec("fps");
    writeStoredSpec("");
    // "persisted nothing" and "never persisted" should be one state, not two.
    expect(localStorage.getItem(DEBUG_STORAGE_KEY)).toBeNull();
  });

  it("survives storage that throws", () => {
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const original = { get: proto.getItem, set: proto.setItem, remove: proto.removeItem };
    const boom = (): never => {
      throw new Error("denied");
    };
    proto.getItem = boom;
    proto.setItem = boom;
    proto.removeItem = boom;
    try {
      expect(readStoredSpec()).toBeNull();
      expect(() => writeStoredSpec("fps")).not.toThrow();
      expect(() => writeStoredSpec("")).not.toThrow();
      expect(() => clearStoredSpec()).not.toThrow();
      expect(anyDebugOn(loadDebugFlags())).toBe(false);
    } finally {
      proto.getItem = original.get;
      proto.setItem = original.set;
      proto.removeItem = original.remove;
    }
  });
});

describe("anyDebugOn (the boot gate)", () => {
  it("is false for a plain session", () => {
    expect(anyDebugOn(loadDebugFlags())).toBe(false);
  });

  it("is true once a spec is stored", () => {
    writeStoredSpec("fps");
    expect(anyDebugOn(loadDebugFlags())).toBe(true);
  });

  it("is true when the URL carries the parameter, even valueless", () => {
    withSearch("?debug", () => expect(anyDebugOn(loadDebugFlags())).toBe(true));
  });

  it("is FALSE for ?debug=off, so the surface never starts", () => {
    // Presence alone was the old gate, and it fetched the chunk and switched on
    // per-frame sim timing for a session that had explicitly asked for none, so
    // a developer measuring a clean baseline measured the instrumentation.
    writeStoredSpec("fps");
    withSearch("?debug=off", () => expect(anyDebugOn(loadDebugFlags())).toBe(false));
  });

  it("is false for a spec of only unknown tokens", () => {
    withSearch("?debug=wat", () => expect(anyDebugOn(loadDebugFlags())).toBe(false));
  });
});

describe("loadDebugFlags", () => {
  it("applies the stored spec when the URL is quiet", () => {
    writeStoredSpec("draw:camera");
    expect(loadDebugFlags().draw).toEqual(["camera"]);
  });

  it("clears the stored spec when the URL says off", () => {
    writeStoredSpec("fps");
    withSearch("?debug=off", () => {
      expect(loadDebugFlags()).toEqual({ ...noDebugFlags(), off: true });
      expect(readStoredSpec()).toBeNull();
    });
  });
});

/** Run `fn` with `window.location.search` replaced, then restore it. happy-dom
 *  makes `location` read-only, so the search is swapped on a redefined property
 *  rather than assigned. */
function withSearch(search: string, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, search },
  });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(window, "location", original);
  }
}
