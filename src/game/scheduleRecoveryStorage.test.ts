import { describe, expect, it } from "vitest";
import { browserAcknowledgements } from "./scheduleRecovery";

describe("browserAcknowledgements", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("remembers a decision across store instances and keeps keys apart", () => {
    const storage = memory();
    browserAcknowledgements(storage).set("a", "kept");
    browserAcknowledgements(storage).set("b", "told");
    expect(browserAcknowledgements(storage).get("a")).toBe("kept");
    expect(browserAcknowledgements(storage).get("b")).toBe("told");
    expect(browserAcknowledgements(storage).get("c")).toBeUndefined();
  });

  it("survives blocked storage and garbage in the slot", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    const store = browserAcknowledgements(blocked);
    expect(() => store.set("a", "kept")).not.toThrow();
    expect(store.get("a")).toBe("kept"); // held for this session, though storage would not take it
    expect(browserAcknowledgements(blocked).get("a")).toBeUndefined(); // a reload forgets it
    const junk = memory();
    junk.setItem("vc-elevator-schedule-review", "[1,2");
    expect(browserAcknowledgements(junk).get("a")).toBeUndefined();
    expect(browserAcknowledgements(undefined).get("a")).toBeUndefined();
  });

  it("lets a newer answer storage refused beat an older one it took", () => {
    const data = new Map<string, string>();
    let full = false;
    const store = browserAcknowledgements({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    });
    store.set("a", "told");
    full = true;
    store.set("a", "kept");
    expect(store.get("a")).toBe("kept");
  });

  it("migrates legacy keys that still carried the old mutable bottom floor, and lets a Keep win a legacy collision", () => {
    const storage = memory();
    storage.setItem(
      "vc-elevator-schedule-review",
      JSON.stringify({
        "classic:1:1139:elevatorStandard:4:1": "kept",
        "classic:1:1139:elevatorStandard:4:2": "told",
        "classic:1:1139:elevatorStandard:4": "told",
      }),
    );
    const store = browserAcknowledgements(storage);
    expect(store.get("classic:1:1139:elevatorStandard:4")).toBe("kept");
    expect(store.get("classic:1:1139:elevatorStandard:4:1")).toBe("kept");
    expect(store.get("classic:1:1139:elevatorStandard:4:2")).toBe("kept");
    store.set("classic:1:1139:elevatorStandard:4", "kept");
    expect(JSON.parse(storage.getItem("vc-elevator-schedule-review") ?? "{}")).toEqual({
      "classic:1:1139:elevatorStandard:4": "kept",
    });
  });

  it("never lets the one-time notice overwrite a Keep, in storage or in memory", () => {
    const storage = memory();
    const store = browserAcknowledgements(storage);
    store.set("a", "kept");
    store.set("a", "told");
    expect(store.get("a")).toBe("kept");
    expect(browserAcknowledgements(storage).get("a")).toBe("kept");
    const data = new Map<string, string>();
    let full = false;
    const tight = browserAcknowledgements({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    });
    tight.set("b", "kept");
    full = true;
    tight.set("b", "told");
    expect(tight.get("b")).toBe("kept");
  });

  it("keeps a legacy Keep through a reload and leaves keys it does not recognize where they are", () => {
    const storage = memory();
    const stored = {
      "classic:1:1139:elevatorStandard:4:1": "told",
      "classic:1:1139:elevatorStandard:4:2": "kept",
      "classic:1:1139:elevatorStandard:4": "told",
      "garbage:more:parts:than:expected": "kept",
      "from-a-newer-build": { note: "x" },
      "classic:2:9:elevatorService:3:1": "maybe",
    };
    storage.setItem("vc-elevator-schedule-review", JSON.stringify(stored));
    const store = browserAcknowledgements(storage);
    expect(store.get("classic:1:1139:elevatorStandard:4")).toBe("kept");
    expect(store.get("from-a-newer-build")).toBeUndefined();
    const after = JSON.parse(storage.getItem("vc-elevator-schedule-review") ?? "{}");
    expect(after).toEqual({
      "classic:1:1139:elevatorStandard:4": "kept",
      "garbage:more:parts:than:expected": "kept",
      "from-a-newer-build": { note: "x" },
      "classic:2:9:elevatorService:3:1": "maybe",
    });
    // The migrated shaft takes the place of its first entry; everything else keeps its place.
    expect(Object.keys(after)).toEqual([
      "classic:1:1139:elevatorStandard:4",
      "garbage:more:parts:than:expected",
      "from-a-newer-build",
      "classic:2:9:elevatorService:3:1",
    ]);
  });

  it("does not rewrite the slot when nothing needs migrating, whatever the entry order", () => {
    const writes: string[] = [];
    const raw = JSON.stringify({ "classic:1:1139:elevatorStandard:4": "kept", unknown: { note: "x" }, "classic:2:9:elevatorService:3": "told" });
    const store = browserAcknowledgements({ getItem: () => raw, setItem: (_k, v) => void writes.push(v) });
    expect(store.get("classic:1:1139:elevatorStandard:4")).toBe("kept");
    expect(writes).toEqual([]);
  });

  it("lets a stored Keep beat an unsaved notice", () => {
    const data = new Map<string, string>([["vc-elevator-schedule-review", JSON.stringify({ a: "kept" })]]);
    let full = false;
    const store = browserAcknowledgements({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    });
    full = true;
    store.set("b", "told"); // refused by storage, held in memory
    data.set("vc-elevator-schedule-review", JSON.stringify({ a: "kept", b: "kept" })); // another tab keeps b
    expect(store.get("b")).toBe("kept");
    full = false;
    store.set("b", "told"); // the notice is written now that storage takes it, and must not undo the Keep
    expect(JSON.parse(data.get("vc-elevator-schedule-review") ?? "{}")).toMatchObject({ a: "kept", b: "kept" });
    expect(store.get("b")).toBe("kept");
  });

  it("lets a legacy Keep beat a canonical notice that comes first in the slot", () => {
    const storage = memory();
    storage.setItem("vc-elevator-schedule-review", JSON.stringify({ "classic:1:1139:elevatorStandard:4:2": "kept", "classic:1:1139:elevatorStandard:4": "told" }));
    expect(browserAcknowledgements(storage).get("classic:1:1139:elevatorStandard:4")).toBe("kept");
  });

  it("migrates a legacy slot with one write however often it is read, and keeps an own '__proto__' entry", () => {
    const data = new Map<string, string>([["vc-elevator-schedule-review", '{"classic:1:1139:elevatorStandard:4:1":"kept","__proto__":{"a":1}}']]);
    let writes = 0;
    const store = browserAcknowledgements({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        writes++;
        data.set(k, v);
      },
    });
    store.get("x");
    store.get("x");
    store.get("classic:1:1139:elevatorStandard:4");
    expect(writes).toBe(1);
    expect(data.get("vc-elevator-schedule-review")).toBe('{"classic:1:1139:elevatorStandard:4":"kept","__proto__":{"a":1}}');
  });

  it("does not let a legacy key overwrite a canonical key holding something unreadable", () => {
    const storage = memory();
    const stored = { "classic:1:1139:elevatorStandard:4": { note: "x" }, "classic:1:1139:elevatorStandard:4:2": "kept" };
    storage.setItem("vc-elevator-schedule-review", JSON.stringify(stored));
    browserAcknowledgements(storage).get("anything");
    expect(JSON.parse(storage.getItem("vc-elevator-schedule-review") ?? "{}")).toEqual(stored);
  });

  it("writes every answer storage refused once it takes a write again, so a reload remembers them (#1601)", () => {
    const data = new Map<string, string>();
    let full = true;
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    };
    const store = browserAcknowledgements(storage);
    store.set("a", "kept"); // refused
    store.set("b", "told"); // refused
    expect(browserAcknowledgements(storage).get("a")).toBeUndefined();
    full = false;
    store.set("c", "told"); // the store works again: this write carries a and b with it
    const reloaded = browserAcknowledgements(storage);
    expect(reloaded.get("a")).toBe("kept");
    expect(reloaded.get("b")).toBe("told");
    expect(reloaded.get("c")).toBe("told");
    expect(Object.keys(JSON.parse(data.get("vc-elevator-schedule-review") ?? "{}"))).toEqual(["a", "b", "c"]);
  });

  it("keeps a held Keep over a stored notice when it catches up, and does not carry an answer once it is stored", () => {
    const data = new Map<string, string>();
    let full = false;
    const writes: string[] = [];
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new Error("quota");
        writes.push(v);
        data.set(k, v);
      },
    };
    const store = browserAcknowledgements(storage);
    store.set("a", "told");
    full = true;
    store.set("a", "kept"); // refused: held as a Keep
    full = false;
    store.set("b", "told");
    expect(JSON.parse(data.get("vc-elevator-schedule-review") ?? "{}")).toEqual({ a: "kept", b: "told" });
    full = true;
    store.set("c", "told"); // refused again; a and b are already stored
    full = false;
    store.set("d", "told");
    // The last write holds each key once, in the order they were answered, and a is still the Keep.
    expect(writes[writes.length - 1]).toBe('{"a":"kept","b":"told","c":"told","d":"told"}');
  });

  it("holds answers for the session when there is no browser storage at all, and trims carried answers past the cap", () => {
    const none = browserAcknowledgements(undefined);
    none.set("a", "kept");
    expect(none.get("a")).toBe("kept");
    const data = new Map<string, string>();
    let full = true;
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    };
    const store = browserAcknowledgements(storage);
    for (let i = 0; i < 450; i++) store.set(`k${i}`, "kept"); // all refused, all held
    full = false;
    store.set("last", "told");
    const stored = Object.keys(JSON.parse(data.get("vc-elevator-schedule-review") ?? "{}"));
    expect(stored).toHaveLength(400);
    expect(stored[stored.length - 1]).toBe("last");
    expect(stored).not.toContain("k0"); // the oldest went first
  });

  it("treats a shaft re-answered while storage is blocked as its newest answer when the held ones are trimmed", () => {
    const data = new Map<string, string>();
    let full = true;
    const store = browserAcknowledgements({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    });
    store.set("first", "told"); // the oldest held answer...
    for (let i = 0; i < 399; i++) store.set(`k${i}`, "kept");
    store.set("first", "kept"); // ...until the player answers it again
    store.set("extra", "told");
    full = false;
    store.set("last", "told"); // 402 held answers do not fit in 400
    const stored = Object.keys(JSON.parse(data.get("vc-elevator-schedule-review") ?? "{}"));
    expect(stored).toHaveLength(400);
    expect(stored).toContain("first"); // kept: it was re-answered after k0 to k398
    expect(stored).not.toContain("k0");
    expect(stored).not.toContain("k1");
  });

  it("does not retry a refused legacy-key rewrite on every read, and tries again after a write goes through (#1601)", () => {
    const data = new Map<string, string>([["vc-elevator-schedule-review", '{"classic:1:1139:elevatorStandard:4:1":"kept"}']]);
    let full = true;
    let attempts = 0;
    const store = browserAcknowledgements({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        attempts++;
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    });
    store.get("x");
    store.get("x");
    store.get("classic:1:1139:elevatorStandard:4");
    expect(attempts).toBe(1);
    expect(store.get("classic:1:1139:elevatorStandard:4")).toBe("kept"); // the canonical copy is still served
    full = false;
    store.set("y", "told");
    expect(JSON.parse(data.get("vc-elevator-schedule-review") ?? "{}")).toEqual({ "classic:1:1139:elevatorStandard:4": "kept", y: "told" });
  });

  it("trims the oldest decisions past its cap", () => {
    const storage = memory();
    const store = browserAcknowledgements(storage);
    for (let i = 0; i < 450; i++) store.set(`k${i}`, "kept");
    expect(store.get("k0")).toBeUndefined();
    expect(store.get("k449")).toBe("kept");
  });
});
