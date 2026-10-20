import { describe, expect, it } from "vitest";
import { browserLaunch, browserName, classifyRenderer, gpuVerified, launchOptions, recordedGpuVerified, rendererBanners, rendererFinding, rendererSummary, type BrowserLaunch } from "./renderer";
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
    for (const s of [RTX, AMD, "ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)", "Mesa Intel(R) Arc(tm) A770 Graphics (DG2)", "AMD Radeon Pro 5500M OpenGL Engine", "Apple M1", "Apple M2 Max", "Adreno (TM) 740", "NVIDIA A100-SXM4-40GB", "NVIDIA L4", "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11, D3D11)", "AMD Radeon(TM) Graphics", "Mesa Intel(R) HD Graphics 520 (SKL GT2)", "Mali-G78", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11, D3D11)"]) expect(classifyRenderer(s), s).toBe("hardware");
  });
  it("calls the software rasterizers software, and lets a software word win over a vendor word", () => {
    for (const s of [SWIFT, "Mesa OffScreen", "Mesa X11", "Gallium 0.4 on swr", "llvmpipe (LLVM 15.0.7, 256 bits)", "Microsoft Basic Render Driver", "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11, D3D11)", "Mesa Software Rasterizer", "Google SwiftShader", "ANGLE (Google, WARP)", "Apple Software Renderer", "ANGLE (Intel, llvmpipe (LLVM 15.0.7))"]) expect(classifyRenderer(s), s).toBe("software");
  });
  it("calls virtual adapters virtual, even when they name a vendor", () => {
    for (const s of ["VMware SVGA 3D", "ANGLE (VMware, VMware SVGA 3D Direct3D11 vs_5_0 ps_5_0, D3D11)", "VirtualBox Graphics Adapter", "Parallels Display Adapter (WDDM)", "Citrix Indirect Display Adapter", "Microsoft Basic Display Adapter", "Microsoft Remote Display Adapter", "virgl (NVIDIA GeForce)", "QEMU Standard VGA"]) expect(classifyRenderer(s), s).toBe("virtual");
  });
  it("calls everything unrecognized, masked or empty unknown, never hardware", () => {
    for (const s of ["null", "undefined", "NULL", "   ", "", "Disabled", "WebKit WebGL", "Google Inc.", "Apple GPU", "NVIDIA", "AMD", "Intel", "ANGLE (Intel)", "Intel, or similar", "ANGLE (NVIDIA, Direct3D11 vs_5_0 ps_5_0, D3D11)", "ANGLE (Mystery Vendor, Thing 9000)", "ANGLE (Google, Vulkan 1.3.0 (renamed), driver)", null, undefined]) expect(classifyRenderer(s), String(s)).toBe("unknown");
  });
});

describe("classifyRenderer, versions and driver builds", () => {
  it("does not take a version number, a driver build or a year for a device", () => {
    for (const s of ["ANGLE (NVIDIA, Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)", "ANGLE (AMD, Vulkan 1.3.260 (AMD), radv)", "ANGLE (Intel, Vulkan 1.3.255 (Unknown Device), Intel open-source Mesa driver)", "Intel 2024", "NVIDIA 31.0.15.3623", "WebKit WebGL, or similar", "NVIDIA GeForce, or similar"]) {
      expect(classifyRenderer(s), s).toBe("unknown");
    }
  });
  it("still names a device that sits beside a version", () => {
    for (const s of ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)", "ANGLE (AMD, Vulkan 1.3.260 (AMD Radeon RX 6800 (RADV NAVI21)), radv)", "NVIDIA A100-SXM4-40GB 535.104.05"]) {
      expect(classifyRenderer(s), s).toBe("hardware");
    }
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
    expect(rendererFinding([RTX, RTX], [RTX, null], full).errors.join()).toMatch(/1 of 2 process runs read a WebGL renderer at their start but none after the frames/);
    expect(rendererFinding([RTX, RTX], [RTX], full).errors.join()).toMatch(/none after the frames/);
  });
  it("only warns on a quick run, for every failure to verify the GPU", () => {
    for (const bad of [SWIFT, "VMware SVGA 3D", "ANGLE (Mystery Vendor, Thing 9000)", "null", null]) {
      const f = rendererFinding([bad], [bad], { quick: true });
      expect(f.errors, String(bad)).toEqual([]);
      expect(f.warnings.length, String(bad)).toBeGreaterThan(0);
    }
  });
  it("keeps a missing renderer an error under an exception, and a warning only for a quick run without one", () => {
    for (const [s, e] of [[[null], [null]], [[], []]] as const) {
      expect(rendererFinding(s, e, { quick: false, exception: "EX-4" }).errors.length).toBeGreaterThan(0);
      expect(rendererFinding(s, e, { quick: true, exception: "EX-4" }).errors.length).toBeGreaterThan(0);
      expect(rendererFinding(s, e, { quick: true }).errors).toEqual([]);
    }
  });
  it("holds the read after the throttled cold start to the same rules, apart from the read after the frames", () => {
    // The cold-start read cannot overwrite a bad read after the frames: both are checked.
    expect(rendererFinding([RTX], [null], { quick: false, lateEnds: [RTX] }).errors.join()).toMatch(/none after the frames/);
    expect(rendererFinding([RTX], [SWIFT], { quick: false, lateEnds: [RTX] }).errors.join()).toMatch(/renderer changed after the frames/);
    expect(rendererFinding([RTX], [RTX], { quick: false, lateEnds: [null] }).errors.join()).toMatch(/none after the cold start/);
    expect(rendererFinding([RTX], [RTX], { quick: true, exception: "EX-4", lateEnds: [AMD] }).errors.join()).toMatch(/different WebGL renderers/);
    // A run with no cold start has no late read to miss.
    expect(rendererFinding([RTX, RTX], [RTX, RTX], { quick: false, lateEnds: [RTX, undefined] })).toEqual({ errors: [], warnings: [] });
    expect(gpuVerified([RTX], [RTX], [null])).toBe(false);
    expect(gpuVerified([RTX], [RTX], [RTX])).toBe(true);
  });
  it("keeps a start read with no end read an error in every mode, since that is how a dead GPU process looks", () => {
    for (const opts of [full, { quick: true }, { quick: false, exception: "EX-4" }]) expect(rendererFinding([RTX], [null], opts).errors.join()).toMatch(/none after the frames/);
    expect(rendererFinding([null], [null], { quick: true }).errors).toEqual([]);
  });
  it("downgrades to warnings that name the register entry when an exception is declared", () => {
    const f = rendererFinding([SWIFT], [SWIFT], { quick: false, exception: "EX-4" });
    expect(f.errors).toEqual([]);
    expect(f.warnings.join()).toMatch(/exception EX-4: .*software rasterizer/);
  });
  it("fails different renderers and a renderer that changed mid-run in every mode", () => {
    for (const opts of [full, { quick: true }, { quick: false, exception: "EX-4" }]) {
      expect(rendererFinding([RTX, AMD], [RTX, AMD], opts).errors.join()).toMatch(/different WebGL renderers/);
      expect(rendererFinding([RTX, RTX], [RTX, SWIFT], opts).errors.join()).toMatch(/renderer changed after the frames in 1 process run/);
      // Every read counts, the later ones as well as the start reads: one process starting on no string and ending on another adapter.
      expect(rendererFinding([RTX, null], [RTX, AMD], opts).errors.join()).toMatch(/different WebGL renderers/);
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
    for (const a of ["--no-sandbox", "--single-process", "--in-process-gpu", "--disable-gpu-compositing", "--disable-threaded-compositing", "--run-all-compositor-stages-before-draw", "--force-device-scale-factor=2", "--enable-features=Vulkan", "--disable-features=X", "--blink-settings=a=b", "--force-color-profile=srgb", "--enable-zero-copy", "--autoplay-policy=x", "--remote-debugging-port=9222", "--headless=old", "--load-extension=x", "--proxy-server=x", "--disable-web-security", "--user-data-dir=x", "--disable-gpu"]) expect(() => browserLaunch({ PW_CHROMIUM_ARGS: a }), a).toThrow(/is not allowed/);
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
    expect(machineOf(env, null, launch({ rendererException: "EX-4", rendererExceptionSha256: "a" }), probe)).not.toEqual(machineOf(env, null, launch({ rendererException: "EX-4", rendererExceptionSha256: "b" }), probe));
    expect(machineOf(env, null, none, { ...probe, version: "142.0.0" })).not.toEqual(base);
    expect(machineOf(env, null, none, { ...probe, renderer: AMD })).not.toEqual(base);
    expect(machineOf(env, null, none, probe)).toEqual(base);
  });
});

describe("report helpers", () => {
  it("names the browser by channel", () => {
    expect([null, "chromium", "chrome", "chrome-beta", "msedge"].map((c) => browserName(c))).toEqual(["Chromium", "Chromium", "Google Chrome", "Google Chrome", "Microsoft Edge"]);
  });
  it("names an installed Chrome or Edge reached through an executable path, and keeps Playwright's own builds Chromium", () => {
    expect(browserName(null, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")).toBe("Google Chrome");
    expect(browserName(null, "/usr/bin/google-chrome")).toBe("Google Chrome");
    expect(browserName(null, "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")).toBe("Microsoft Edge");
    expect(browserName(null, "C:\\Users\\n\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe")).toBe("Chromium");
    expect(browserName(null, null)).toBe("Chromium");
    expect(browserName(null, "C:\\tools\\chrome-for-testing\\chrome-win64\\chrome.exe")).toBe("Chromium");
    expect(browserName(null, "D:\\pw-copy\\chrome-win64\\chrome.exe")).toBe("Chromium");
  });
  it("shows the start and end renderers only when they differ", () => {
    const run = (a: string | null, b: string | null, ok = true) => ({ ok, page: { webgl: a ? { renderer: a } : null }, rendererEnd: b });
    expect(rendererSummary([run(RTX, RTX), run(RTX, RTX)])).toBe(RTX);
    expect(rendererSummary([run(RTX, SWIFT)])).toBe(`${RTX} (at the start); ${SWIFT} (at the end)`);
    expect(rendererSummary([run(RTX, RTX), run(null, null, false)])).toBe(RTX);
    expect(rendererSummary([run(null, null)])).toBe("none");
  });
  it("leads with a banner for a declared exception, and for a smoke run whose GPU was not verified", () => {
    expect(rendererBanners({ rendererException: "EX-4", rendererExceptionSha256: "ab12", rendererExceptionCommit: "0123456789abcdef" }, false).join()).toMatch(/Renderer exception EX-4 declared.*ab12.*origin\/main at 0123456789ab.*not verified GPU evidence/);
    expect(rendererBanners({ gpuVerified: false }, true).join()).toMatch(/Smoke run.*no frame row in it is GPU evidence/);
    expect(rendererBanners({ gpuVerified: true }, true)).toEqual([]);
    expect(rendererBanners({ gpuVerified: false }, false)).toEqual([]);
    expect(rendererBanners({ rendererException: "EX-4", gpuVerified: false }, true)).toHaveLength(2);
  });
  it("marks a run GPU-verified only for good hardware reads at both ends, with no allowance", () => {
    expect(gpuVerified([RTX, RTX], [RTX, RTX])).toBe(true);
    expect(gpuVerified([], [])).toBe(false);
    // A declared exception records false even when every read was hardware.
    expect(recordedGpuVerified(null, [RTX], [RTX], [RTX])).toBe(true);
    expect(recordedGpuVerified("EX-4", [RTX], [RTX], [RTX])).toBe(false);
    expect(gpuVerified([RTX], [null])).toBe(false);
    expect(gpuVerified([SWIFT], [SWIFT])).toBe(false);
    expect(gpuVerified([RTX, AMD], [RTX, AMD])).toBe(false);
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
    expect(rendererLimitation([RTX], "EX-4").join()).toMatch(/exception EX-4 was declared.*warnings.*owner-approved register entry/);
  });
});
