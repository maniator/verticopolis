// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
vi.mock("../../ui/downloadFile", () => ({ downloadFile: vi.fn() }));
import { downloadFile } from "../../ui/downloadFile";
import { mountAppDom, makeUI } from "../uiFixture";
import { Simulation } from "../../engine/Simulation";
import { TsEngine } from "../../engine/port/tsEngine";
import { ViewReader } from "../../simport/viewReader";
import { facilityFloors } from "../../engine/facilities";
import { countRustCrash, crashReportDue, heldAfterCrashes } from "../../engineCohort/crashReload";
import { offerRustCrashReport, type RustCrashApp } from "../../ui/rustCrashDialog";
import { TS_ENGINE_VERSION } from "../../wasmhost/tsEngineIdentity";

/**
 * The Rust crash report (#1422): the TypeScript boot after the tab's second
 * Rust crash offers it once, in the shared dialog, and its zip carries both
 * engines, the fault and the save the running TypeScript engine writes.
 */

const SHA = "build-a";
const FACTS = { reason: "trap-tick", stage: "start", rust: { version: "0.21.0", sourceHash: "f".repeat(64) } };
const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;

function app(): RustCrashApp {
  const { ui } = makeUI();
  const sim = new Simulation();
  sim.tower.towerName = "After The Crash";
  const port = new TsEngine(sim);
  return { ui, reader: new ViewReader(port, facilityFloors), enginePort: port, speed: 1 };
}

describe("the Rust crash report", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mountAppDom();
  });
  afterEach(() => {
    vi.mocked(downloadFile).mockClear();
    document.body.innerHTML = "";
  });

  it("is offered once, after the second crash, and Keep playing closes it", () => {
    const a = app();
    countRustCrash(sessionStorage, SHA, FACTS);
    expect(offerRustCrashReport(a, SHA)).toBe(false);
    countRustCrash(sessionStorage, SHA, FACTS);
    expect(offerRustCrashReport(a, SHA)).toBe(true);
    expect(dialog().open).toBe(true);
    expect(dialog().textContent).toContain("The Rust engine crashed twice, so this game is running on the TypeScript engine for now.");
    const report = dialog().querySelector<HTMLAnchorElement>('[data-act="report"]')!;
    expect(new URL(report.href).searchParams.get("title")).toBe("Rust engine crashed");
    dialog().querySelector<HTMLElement>('[data-act="close"]')!.click();
    expect(dialog().open).toBe(false);
    // Retired for the tab; the tab stays on TypeScript.
    expect(crashReportDue(sessionStorage, SHA)).toBeNull();
    expect(offerRustCrashReport(a, SHA)).toBe(false);
    expect(heldAfterCrashes(sessionStorage, SHA)).toBe(true);
  });

  it("downloads a zip with both engines, the fault and the TypeScript engine's save", async () => {
    countRustCrash(sessionStorage, SHA, FACTS);
    countRustCrash(sessionStorage, SHA, FACTS);
    offerRustCrashReport(app(), SHA);
    dialog().querySelector<HTMLElement>('[data-act="download"]')!.click();
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
    const [filename, bytes, mime] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toMatch(/^verticopolis-crash-report-.*\.zip$/);
    expect(mime).toBe("application/zip");
    const files = unzipSync(bytes as Uint8Array);
    const details = JSON.parse(strFromU8(files["crash-report.json"]));
    expect(details).toMatchObject({
      crash: { kind: "rust-engine-trap", crashes: 2, reason: "trap-tick", stage: "start" },
      engines: { rust: FACTS.rust, typescript: { version: TS_ENGINE_VERSION } },
      tower: { name: "After The Crash" },
    });
    expect(typeof details.userAgent).toBe("string");
    expect(strFromU8(files["tower.vctower"])).toMatch(/^VCTOWER1\n/);
    expect(dialog().querySelector(".crash-status")?.textContent).toContain("Crash report ready.");
  });
});
