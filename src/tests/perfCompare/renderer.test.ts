import { describe, expect, it } from "vitest";
import { browserLaunch, browserName, classifyRenderer, exceptionBanner, launchOptions, rendererFinding, rendererSummary, type BrowserLaunch } from "./renderer";
import { gateBrowser } from "./browserProbe";
import { rendererLimitation } from "./limitations";
import { machineOf } from "./main";
import type { Environment } from "./env";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
const AMD = "ANGLE (AMD, AMD Radeon RX 6800 Direct3D11, D3D11)";
const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
const none = { channel: null, args: [], rendererException: null } satisfies BrowserLaunch;
const launch = (over: Partial<BrowserLaunch> = {}): BrowserLaunch => ({ ...none, ...over });

describe("classifyRenderer", () => {
  it("names hardware only from an allowlist of adapter vendors and families", () => {
    for (const s of [RTX, AMD, "ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)", "Mesa Intel(R) Arc(tm) A770 Graphics (DG2)", "AMD Radeon Pro 5500M OpenGL Engine", "Apple M1", "Apple GPU", "Adreno (TM) 740", "Mali-G78", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11, D3D11)"]) expect(classifyRenderer(s), s).toBe("hardware");
  });
  it("calls the software rasterizers software, and lets a software word win over a vendor word", () => {
    for (const s of [SWIFT, "Mesa OffScreen", "Mesa X11", "Gallium 0.4 on swr", "llvmpipe (LLVM 15.0.7, 256 bits)", "Microsoft Basic Render Driver", "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11, D3D11)", "Mesa Software Rasterizer", "Google SwiftShader", "ANGLE (Google, WARP)", "Apple Software Renderer", "ANGLE (Intel, llvmpipe (LLVM 15.0.7))"]) expect(classifyRenderer(s), s).toBe("software");
  });
  it("calls virtual adapters virtual, even when they name a vendor", () => {
    for (const s of ["VMware SVGA 3D", "ANGLE (VMware, VMware SVGA 3D Direct3D11 vs_5_0 ps_5_0, D3D11)", "VirtualBox Graphics Adapter", "Parallels Display Adapter (WDDM)", "Citrix Indirect Display Adapter", "Microsoft Basic Display Adapter", "Microsoft Remote Display Adapter", "virgl (NVIDIA GeForce)", "QEMU Standard VGA"]) expect(classifyRenderer(s), s).toBe("virtual");
  });
  it("calls everything unrecognized, masked or empty unknown, never hardware", () => {
    for (const s of ["null", "undefined", "NULL", "   ", "", "Disabled", "WebKit WebGL", "Google Inc.", "ANGLE (Mystery Vendor, Thing 9000)", "ANGLE (Google, Vulkan 1.3.0 (renamed), driver)", null, undefined]) expect(classifyRenderer(s), String(s)).toBe("unknown");
  });
});

describe("rendererFinding", () => {
  const full = { quick: false };
  it("passes a hardware renderer read before and after the frames", () => {
    expect(rendererFinding([RTX, RTX], [RTX, RTX], full)).toEqual({ errors: [], warnings: [] });
  });
  it("fails closed on a full run for software, virtual, unknown, masked and missing renderers", () => {
    for (const bad of [SWIFT, "VMware SVGA 3D", "ANGLE (Mystery Vendor, Thing 9000)", "WebKit WebGL", "null", null, undefined]) {
      const f = rendererFinding([bad, bad], [bad, bad], full);
      expect(f.errors.length, String(bad)).toBeGreaterThan(0);
    }
    expect(rendererFinding([SWIFT, SWIFT], [SWIFT, SWIFT], full).errors[0]).toMatch(/software rasterizer \(.*SwiftShader.*\).*run it on the GPU/);
    expect(rendererFinding([], [], full).errors[0]).toMatch(/no process run recorded a WebGL renderer/);
  });
  it("lets a missing string beside a GPU one, or a missing read after the frames, fail too", () => {
    expect(rendererFinding([RTX, null, null, null], [RTX, RTX, RTX, RTX], full).errors.join()).toMatch(/3 of 4 process runs recorded no WebGL renderer at their start/);
    expect(rendererFinding([RTX, RTX], [RTX, null], full).errors.join()).toMatch(/1 of 2 process runs have no WebGL renderer read after the frames/);
    expect(rendererFinding([RTX, RTX], [RTX], full).errors.join()).toMatch(/no WebGL renderer read after the frames/);
  });
  it("only warns on a quick run, for every failure to verify the GPU", () => {
    for (const bad of [SWIFT, "VMware SVGA 3D", "ANGLE (Mystery Vendor, Thing 9000)", "null", null]) {
      const f = rendererFinding([bad], [bad], { quick: true });
      expect(f.errors, String(bad)).toEqual([]);
      expect(f.warnings.length, String(bad)).toBeGreaterThan(0);
    }
    expect(rendererFinding([RTX], [null], { quick: true }).errors).toEqual([]);
  });
  it("downgrades to warnings that name the register entry when an exception is declared", () => {
    const f = rendererFinding([SWIFT], [SWIFT], { quick: false, exception: "EX-4" });
    expect(f.errors).toEqual([]);
    expect(f.warnings.join()).toMatch(/exception EX-4: .*software rasterizer/);
  });
  it("fails different renderers and a renderer that changed mid-run in every mode", () => {
    for (const opts of [full, { quick: true }, { quick: false, exception: "EX-4" }]) {
      expect(rendererFinding([RTX, AMD], [RTX, AMD], opts).errors.join()).toMatch(/different WebGL renderers/);
      expect(rendererFinding([RTX, RTX], [RTX, SWIFT], opts).errors.join()).toMatch(/renderer changed during 1 process run/);
    }
  });
});

describe("browserLaunch", () => {
  it("reads the channel, the GPU switches and the exception from the environment", () => {
    expect(browserLaunch({})).toEqual(none);
    expect(browserLaunch({ PW_CHROMIUM_CHANNEL: " Chrome ", PW_CHROMIUM_ARGS: "--use-angle=d3d11  --ignore-gpu-blocklist", PW_RENDERER_EXCEPTION: "ex-12" })).toEqual({ channel: "chrome", args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"], rendererException: "EX-12" });
    expect(browserLaunch({ PW_CHROMIUM_PATH: "/x/chrome" })).toEqual(none);
  });
  it("checks switch names without regard to case, which is how Chromium on Windows reads them", () => {
    expect(browserLaunch({ PW_CHROMIUM_ARGS: "--USE-ANGLE=D3D11" }).args).toEqual(["--use-angle=d3d11"]);
    for (const a of ["--JS-Flags=--expose-gc", "--Disable-Frame-Rate-Limit", "--Disable-GPU-Vsync", "--ENABLE-FEATURES=X", "--Blink-Settings=imagesEnabled=true"]) expect(() => browserLaunch({ PW_CHROMIUM_ARGS: a }), a).toThrow(/is not allowed/);
    expect(() => browserLaunch({ PW_CHROMIUM_ARGS: "--use-angle=d3d11 --USE-ANGLE=gl" })).toThrow(/given twice/);
  });
  it("accepts only the GPU-selection switches, with well-formed values", () => {
    for (const a of ["--no-sandbox", "--single-process", "--in-process-gpu", "--disable-gpu-compositing", "--disable-threaded-compositing", "--run-all-compositor-stages-before-draw", "--force-device-scale-factor=2", "--enable-features=Vulkan", "--disable-features=X", "--blink-settings=a=b", "--force-color-profile=srgb", "--autoplay-policy=x", "--remote-debugging-port=9222", "--headless=old", "--load-extension=x", "--proxy-server=x", "--disable-web-security", "--user-data-dir=x", "--disable-gpu"]) expect(() => browserLaunch({ PW_CHROMIUM_ARGS: a }), a).toThrow(/is not allowed/);
    for (const a of ["--", "--=x", "-x", "nope", "--a b", "--use-angle=\"d3d11\""]) expect(() => browserLaunch({ PW_CHROMIUM_ARGS: a }), a).toThrow(/PW_CHROMIUM_ARGS/);
    expect(() => browserLaunch({ PW_CHROMIUM_ARGS: "--use-angle" })).toThrow(/needs a value/);
    expect(() => browserLaunch({ PW_CHROMIUM_ARGS: "--use-angle=a;b" })).toThrow(/needs a value/);
    expect(() => browserLaunch({ PW_CHROMIUM_ARGS: "--ignore-gpu-blocklist=1" })).toThrow(/takes no value/);
  });
  it("refuses a bad channel, a channel with an executable, and a malformed exception, all at parse time", () => {
    expect(() => browserLaunch({ PW_CHROMIUM_CHANNEL: "firefox" })).toThrow(/is not a channel/);
    expect(() => browserLaunch({ PW_CHROMIUM_CHANNEL: "chrome", PW_CHROMIUM_PATH: "/x/chrome" })).toThrow(/not both/);
    for (const x of ["4", "EX-", "EX-4a", "waiver", "EX-4; rm"]) expect(() => browserLaunch({ PW_RENDERER_EXCEPTION: x }), x).toThrow(/exception-register entry/);
  });
  it("builds the launch options with the base switches first and a channel only without an executable", () => {
    const o = launchOptions(null, launch({ channel: "chrome", args: ["--use-angle=d3d11"] }));
    expect(o).toMatchObject({ headless: true, channel: "chrome" });
    expect(o.args).toEqual(["--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc", "--use-angle=d3d11"]);
    expect(launchOptions("/x/chrome", launch({ channel: "chrome" }))).toMatchObject({ executablePath: "/x/chrome" });
    expect(launchOptions("/x/chrome", launch({ channel: "chrome" }))).not.toHaveProperty("channel");
    expect(launchOptions(null, none)).not.toHaveProperty("channel");
  });
});

describe("gateBrowser", () => {
  it("stops a full run on an unverified renderer before any build, and passes hardware", () => {
    expect(gateBrowser({ version: "141", renderer: RTX }, false, none)).toEqual([]);
    expect(() => gateBrowser({ version: "141", renderer: SWIFT }, false, none)).toThrow(/cannot be used for this run.*software rasterizer/s);
    expect(() => gateBrowser({ version: "141", renderer: null }, false, launch({ channel: "chrome" }))).toThrow(/channel chrome/);
    expect(gateBrowser({ version: "141", renderer: SWIFT }, true, none).join()).toMatch(/software rasterizer/);
    expect(gateBrowser({ version: "141", renderer: SWIFT }, false, launch({ rendererException: "EX-4" })).join()).toMatch(/exception EX-4/);
  });
});

describe("machineOf", () => {
  const env = { cpuModel: "c", logicalCpus: 1, totalMemoryBytes: 1, os: "o", kernel: "k", arch: "a", node: "n", rust: null, playwright: "p" } as unknown as Environment;
  const probe = { version: "141.0.1", renderer: RTX };
  it("puts the launch settings, the browser build and the renderer in the identity, so a resume with any of them changed is refused", () => {
    const base = machineOf(env, null, none, probe);
    expect(base).toMatchObject({ browserVersion: "141.0.1", renderer: RTX, launch: JSON.stringify(none) });
    expect(machineOf(env, null, launch({ channel: "chrome" }), probe)).not.toEqual(base);
    expect(machineOf(env, null, launch({ args: ["--use-angle=d3d11"] }), probe)).not.toEqual(base);
    expect(machineOf(env, null, launch({ rendererException: "EX-4" }), probe)).not.toEqual(base);
    expect(machineOf(env, null, none, { ...probe, version: "142.0.0" })).not.toEqual(base);
    expect(machineOf(env, null, none, { ...probe, renderer: AMD })).not.toEqual(base);
    expect(machineOf(env, null, none, probe)).toEqual(base);
  });
});

describe("report helpers", () => {
  it("names the browser by channel", () => {
    expect([null, "chromium", "chrome", "chrome-beta", "msedge"].map(browserName)).toEqual(["Chromium", "Chromium", "Google Chrome", "Google Chrome", "Microsoft Edge"]);
  });
  it("shows the start and end renderers only when they differ", () => {
    const run = (a: string | null, b: string | null) => ({ page: { webgl: a ? { renderer: a } : null }, rendererEnd: b });
    expect(rendererSummary([run(RTX, RTX), run(RTX, RTX)])).toBe(RTX);
    expect(rendererSummary([run(RTX, SWIFT)])).toBe(`${RTX} (at the start); ${SWIFT} (after the frames)`);
    expect(rendererSummary([run(null, null)])).toBe("none");
  });
  it("leads with a banner for a declared exception, and says nothing otherwise", () => {
    expect(exceptionBanner("EX-4")).toMatch(/Renderer exception EX-4 declared.*not a pass/);
    expect(exceptionBanner(null)).toBeNull();
  });
});

describe("rendererLimitation", () => {
  it("classifies every distinct renderer on its own", () => {
    expect(rendererLimitation([SWIFT])[0]).toMatch(/software rasterizer.*frame rows are invalid.*fails validation/);
    expect(rendererLimitation([RTX])[0]).toMatch(/Frame rates are for this GPU/);
    const both = rendererLimitation([RTX, SWIFT]);
    expect(both).toHaveLength(2);
    expect(both[1]).toMatch(/software rasterizer/);
    expect(rendererLimitation(["VMware SVGA 3D"])[0]).toMatch(/virtual display adapter/);
    expect(rendererLimitation(["ANGLE (Mystery Vendor, Thing 9000)"])[0]).toMatch(/does not name a hardware adapter/);
    expect(rendererLimitation([])[0]).toMatch(/No WebGL renderer was recorded/);
    expect(rendererLimitation([RTX], "EX-4").join()).toMatch(/exception EX-4 was declared.*warnings, not a pass/);
  });
});
