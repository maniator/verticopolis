import { describe, it, expect } from "vitest";
import { asScopeToken, type SaveScopeToken, type SaveStorePort } from "../platform/saveStore";
import {
  idsInScope,
  migrationTarget,
  openSaveStore,
  recordAt,
  resolveWriteTarget,
  sessionFromSnapshot,
  type SaveStoreSession,
} from "./saveStoreSession";

const LOCAL: SaveScopeToken = asScopeToken("local");
/** A SECOND scope, which no shell offers today. Every account-selective rule in
 *  this module is unreachable without one, so the fixture is what makes those
 *  rules testable now instead of after they are needed. */
const ACCOUNT: SaveScopeToken = asScopeToken("account:76561198027391269");

const SNAPSHOT = {
  scopes: [
    { token: LOCAL, label: "Towers on this computer" },
    { token: ACCOUNT, label: "Your towers" },
  ],
  records: [
    { id: "auto", scope: LOCAL, bytes: 100 },
    { id: "slot-1", scope: ACCOUNT, bytes: 200 },
  ],
};

function sessionOf(snapshot: unknown = SNAPSHOT): SaveStoreSession {
  return sessionFromSnapshot(snapshot);
}

describe("sessionFromSnapshot treats the snapshot as untrusted", () => {
  it("keeps well-formed records and scopes", () => {
    const s = sessionOf();
    expect(s.records.map((r) => r.id)).toEqual(["auto", "slot-1"]);
    expect(s.scopes.map((x) => x.label)).toEqual(["Towers on this computer", "Your towers"]);
    expect(s.defaultScope).toBe(LOCAL);
  });

  it("drops a record whose id is not one the game owns", () => {
    // The duck-check that admitted the port verified four function NAMES and
    // nothing about what they resolve to. An unrecognized id carried through
    // would surface as a phantom slot in the saves list.
    const s = sessionOf({
      scopes: [{ token: LOCAL, label: "L" }],
      records: [
        { id: "auto", scope: LOCAL, bytes: 1 },
        { id: "slot-9", scope: LOCAL, bytes: 1 },
        { id: "../escape", scope: LOCAL, bytes: 1 },
        { id: "__proto__", scope: LOCAL, bytes: 1 },
      ],
    });
    expect(s.records.map((r) => r.id)).toEqual(["auto"]);
  });

  it("drops a record whose scope no listed scope covers", () => {
    // Otherwise the UI holds a token it has no label for, and a write could be
    // aimed at a scope the shell never said it had.
    const s = sessionOf({
      scopes: [{ token: LOCAL, label: "L" }],
      records: [
        { id: "auto", scope: LOCAL, bytes: 1 },
        { id: "slot-1", scope: asScopeToken("ghost"), bytes: 1 },
      ],
    });
    expect(s.records.map((r) => r.id)).toEqual(["auto"]);
  });

  it("survives every shape a malformed list() can resolve", () => {
    // Calls `sessionFromSnapshot` directly rather than through the `sessionOf`
    // helper: that helper defaults its argument, so passing `undefined` through
    // it would silently test the GOOD snapshot instead. Caught by this case
    // failing with the well-formed records it was supposed to have rejected.
    for (const bad of [null, undefined, 42, "snapshot", {}, { scopes: 1, records: 2 }, { records: [{}] }]) {
      const s = sessionFromSnapshot(bad);
      expect(s.records, JSON.stringify(bad)).toEqual([]);
      expect(s.scopes, JSON.stringify(bad)).toEqual([]);
      expect(s.defaultScope, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("drops a scope whose token or label is not a string", () => {
    const s = sessionOf({ scopes: [{ token: LOCAL, label: 42 }, { token: null, label: "x" }], records: [] });
    expect(s.scopes).toEqual([]);
  });
});

describe("idsInScope is scope-aware", () => {
  it("reports only the ids present in the scope asked about", () => {
    // The migration derives its done-marker from this. A record sitting in
    // ANOTHER scope must not suppress a migration into this one, or a player
    // whose towers live in an account directory would silently never get their
    // shared-namespace towers moved.
    expect([...idsInScope(sessionOf(), LOCAL)]).toEqual(["auto"]);
    expect([...idsInScope(sessionOf(), ACCOUNT)]).toEqual(["slot-1"]);
    expect([...idsInScope(sessionOf(), asScopeToken("nowhere"))]).toEqual([]);
  });

  it("distinguishes the same id in two scopes", () => {
    // The case that breaks any id-only addressing: `slot-1` legitimately exists
    // in both, and they are different towers.
    const s = sessionOf({
      scopes: [
        { token: LOCAL, label: "L" },
        { token: ACCOUNT, label: "A" },
      ],
      records: [
        { id: "slot-1", scope: LOCAL, bytes: 1 },
        { id: "slot-1", scope: ACCOUNT, bytes: 2 },
      ],
    });
    expect(recordAt(s, { id: "slot-1", scope: LOCAL })?.bytes).toBe(1);
    expect(recordAt(s, { id: "slot-1", scope: ACCOUNT })?.bytes).toBe(2);
  });
});

describe("resolveWriteTarget: autosave follows the tower's ORIGIN", () => {
  it("writes a tower back to the scope it was opened from", () => {
    const target = resolveWriteTarget(sessionOf(), "slot-1", { id: "slot-1", scope: ACCOUNT });
    expect(target).toEqual({ ok: true, target: { id: "slot-1", scope: ACCOUNT } });
  });

  it("does NOT write it to the default scope, even though that is where new towers go", () => {
    // The whole point. `LOCAL` is the default and would be the natural fallback,
    // and using it would copy an account's tower into the namespace every
    // account on this machine can read.
    const s = sessionOf();
    expect(s.defaultScope).toBe(LOCAL);
    const target = resolveWriteTarget(s, "slot-1", { id: "slot-1", scope: ACCOUNT });
    expect(target.ok && target.target.scope).toBe(ACCOUNT);
  });

  it("REFUSES when the origin scope has disappeared", () => {
    // On a desktop shell this is the account changing mid-session. Falling back
    // to the default scope here is the specific mistake this function exists to
    // prevent, so the refusal is asserted rather than the fallback.
    const onlyLocal = sessionOf({ scopes: [{ token: LOCAL, label: "L" }], records: [] });
    expect(resolveWriteTarget(onlyLocal, "slot-1", { id: "slot-1", scope: ACCOUNT })).toEqual({
      ok: false,
      refusal: "origin-gone",
    });
  });

  it("sends a tower with no origin to the default scope", () => {
    // A new game, or one imported from a file: there is no origin to honor, and
    // a first save has to go somewhere.
    expect(resolveWriteTarget(sessionOf(), "auto", undefined)).toEqual({
      ok: true,
      target: { id: "auto", scope: LOCAL },
    });
  });

  it("refuses everything when no scope exists at all", () => {
    const empty = sessionOf({ scopes: [], records: [] });
    expect(resolveWriteTarget(empty, "auto", undefined)).toEqual({ ok: false, refusal: "no-store" });
  });

  it("keeps the id asked for rather than the id the tower came from", () => {
    // Save As onto a different slot: the destination id is the caller's, the
    // scope is the tower's. Conflating them would either write the wrong slot
    // or leak the tower into the wrong namespace.
    const target = resolveWriteTarget(sessionOf(), "slot-2", { id: "slot-1", scope: ACCOUNT });
    expect(target).toEqual({ ok: true, target: { id: "slot-2", scope: ACCOUNT } });
  });
});

describe("openSaveStore", () => {
  const portWith = (list: () => Promise<unknown>): SaveStorePort =>
    ({
      list,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }) as unknown as SaveStorePort;

  it("resolves a session from a well-formed snapshot", async () => {
    const session = await openSaveStore(portWith(() => Promise.resolve(SNAPSHOT)));
    expect(session?.defaultScope).toBe(LOCAL);
    expect(session?.records.length).toBe(2);
  });

  it("returns null when list() rejects, which is a fallback and not a boot failure", async () => {
    expect(await openSaveStore(portWith(() => Promise.reject(new Error("io"))))).toBeNull();
  });

  it("returns null when list() resolves something malformed", async () => {
    for (const bad of [null, 42, {}, { scopes: [], records: [] }]) {
      expect(await openSaveStore(portWith(() => Promise.resolve(bad))), JSON.stringify(bad)).toBeNull();
    }
  });

  it("returns null when the store offers no scope, since it could not be written to", async () => {
    // Indistinguishable from having no store, so it is said once here rather
    // than rediscovered at every write site.
    const noScopes = { scopes: [], records: [{ id: "auto", scope: LOCAL, bytes: 1 }] };
    expect(await openSaveStore(portWith(() => Promise.resolve(noScopes)))).toBeNull();
  });

  it("does not let a throwing list() escape into boot", async () => {
    const thrower = portWith(() => {
      throw new Error("synchronous throw, not a rejection");
    });
    await expect(openSaveStore(thrower)).resolves.toBeNull();
  });
});

describe("sharedScope: the migration's only legal destination", () => {
  it("is the scope the shell marked shared, not the first one", () => {
    // Order must not decide where towers land. The shell says which namespace
    // is shared across accounts; the game does not infer it.
    const s = sessionFromSnapshot({
      scopes: [
        { token: ACCOUNT, label: "Your towers" },
        { token: LOCAL, label: "Towers on this computer", shared: true },
      ],
      records: [],
    });
    expect(s.defaultScope).toBe(ACCOUNT);
    expect(s.sharedScope).toBe(LOCAL);
    expect(migrationTarget(s)).toBe(LOCAL);
  });

  it("refuses to guess when no scope is marked shared", () => {
    // The conservative answer, and the important one. Falling back to
    // defaultScope here is exactly how the previous account's leftover towers
    // would end up in the current account's Steam Cloud. Skipping costs
    // nothing: localStorage keeps them and a later boot moves them.
    const s = sessionFromSnapshot({ scopes: [{ token: ACCOUNT, label: "A" }], records: [] });
    expect(s.defaultScope).toBe(ACCOUNT);
    expect(s.sharedScope).toBeUndefined();
    expect(migrationTarget(s)).toBeNull();
  });

  it("refuses when a malformed shell marks two scopes shared", () => {
    // Picking one would make the destination depend on array order, which is
    // the same class of bug as guessing.
    const s = sessionFromSnapshot({
      scopes: [
        { token: LOCAL, label: "L", shared: true },
        { token: ACCOUNT, label: "A", shared: true },
      ],
      records: [],
    });
    expect(migrationTarget(s)).toBeNull();
  });

  it("treats a non-true shared flag as not shared", () => {
    for (const shared of ["yes", 1, {}, null]) {
      const s = sessionFromSnapshot({ scopes: [{ token: LOCAL, label: "L", shared }], records: [] });
      expect(migrationTarget(s), JSON.stringify(shared)).toBeNull();
    }
  });

  it("migrationTarget can never return an account scope", () => {
    // The property, stated directly: whatever the snapshot looks like, the
    // migration's destination is either the shell-marked shared scope or
    // nothing. There is no input that makes it name an unmarked scope.
    const snapshots = [
      { scopes: [{ token: ACCOUNT, label: "A" }], records: [] },
      { scopes: [{ token: ACCOUNT, label: "A" }, { token: LOCAL, label: "L", shared: true }], records: [] },
      { scopes: [{ token: ACCOUNT, label: "A", shared: true }], records: [] },
    ];
    for (const snap of snapshots) {
      const target = migrationTarget(sessionFromSnapshot(snap));
      expect(target === null || target === sessionFromSnapshot(snap).sharedScope).toBe(true);
      // Never the default merely because it was default.
      if (target !== null) {
        expect(sessionFromSnapshot(snap).scopes.find((x) => x.token === target)?.shared).toBe(true);
      }
    }
  });
});
