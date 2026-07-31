import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The boot WIRING of the save store, which nothing else can cover.
 *
 * The call site is `if (IS_WRAPPED_BUILD) await prepareSaveStore()`, and that
 * constant is `false` under vitest by construction, so in every other test the
 * line does not run. It could be deleted with the whole suite green. The build
 * guard would not notice either: it greps the emitted bundle for string
 * literals, which survive as long as the module is imported at all, and it
 * cannot see ORDER.
 *
 * Order is the entire point here. `SaveGame.load`, `hasSave`, `listSlots` and
 * `hasSlot` run inside the `GameApp` constructor and behind the splash, and the
 * reason boot awaits the store before `create()` is so those readers can answer
 * from a resolved snapshot instead of being made async up through the splash
 * controller. A version that resolved the store after the game constructed
 * would pass every other test and every build check, and would silently show
 * the player an empty saves list on the first boot after a migration.
 */

const order: string[] = [];

vi.mock("./platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./platform")>()),
  IS_WRAPPED_BUILD: true,
}));

const prepareSaveStore = vi.fn(async () => {
  // Yield, so "before" cannot pass merely because the mock is synchronous.
  await Promise.resolve();
  order.push("prepareSaveStore");
});

vi.mock("./game/desktopSaveStore", () => ({
  prepareSaveStore: () => prepareSaveStore(),
  saveStoreSession: () => null,
  saveMigrationReport: () => null,
  resetSaveStoreForTests: () => {},
}));

vi.mock("./pwa", () => ({ registerPWA: vi.fn() }));
vi.mock("./telemetry", () => ({ injectVercelTelemetry: vi.fn() }));
vi.mock("./analytics", () => ({ startGameplaySession: vi.fn(), trackAppActionOnce: vi.fn() }));
vi.mock("./analyticsErrors", () => ({ installErrorTracking: vi.fn() }));
vi.mock("./pwaInstall", () => ({ initPwaInstall: vi.fn() }));

const { bootGame } = await import("./bootstrap");

/** WebGL must probe true or boot bails before reaching either call. */
function stubWebGL(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as unknown as RenderingContext);
}

beforeEach(() => {
  order.length = 0;
  prepareSaveStore.mockReset();
  document.body.innerHTML = `<div id="stage"></div>`;
  vi.restoreAllMocks();
  stubWebGL();
});

describe("boot resolves the save store before the game constructs", () => {
  it("awaits prepareSaveStore, then calls create", async () => {
    const create = vi.fn(() => {
      order.push("create");
      return { onUpdateAvailable: vi.fn() };
    });

    await bootGame(create);

    expect(prepareSaveStore).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["prepareSaveStore", "create"]);
  });

  it("actually AWAITS it rather than firing it alongside create", async () => {
    // The failure this catches: dropping the `await`. `create` would then run
    // while the store was still resolving, the synchronous readers would answer
    // from nothing, and the ordering above would still hold by luck on a fast
    // mock. A deliberately slow resolve makes the difference observable.
    let released!: () => void;
    prepareSaveStore.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (released = r));
      order.push("prepareSaveStore");
    });
    const create = vi.fn(() => {
      order.push("create");
      return { onUpdateAvailable: vi.fn() };
    });

    const booted = bootGame(create);
    await Promise.resolve();
    // Still blocked: the store has not resolved, so the game must not exist yet.
    expect(create).not.toHaveBeenCalled();

    released();
    await booted;
    expect(order).toEqual(["prepareSaveStore", "create"]);
  });

  it("boots anyway when the store preparation rejects", async () => {
    // `prepareSaveStore` is documented and tested never to reject, and this
    // await sits outside boot's try/catch, so a rejection would otherwise skip
    // the boot message and leave a blank page. The guard at the call site is
    // what makes "cannot take boot down" structural rather than a promise made
    // by a module three imports away.
    prepareSaveStore.mockRejectedValueOnce(new Error("shell exploded"));
    const create = vi.fn(() => ({ onUpdateAvailable: vi.fn() }));

    await expect(bootGame(create)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not reach the store when WebGL is missing", async () => {
    // Boot bails before the game runs at all, so there is nothing to load and
    // no reason to spin up a shell round trip.
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const create = vi.fn(() => ({ onUpdateAvailable: vi.fn() }));

    await bootGame(create);

    expect(prepareSaveStore).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
