/// <reference types="vite/client" />

/** Compile-time constants injected by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Short git SHA of this build, or "unknown" outside a checkout. */
declare const __APP_SHA__: string;
/** True only in a tooling build (`VC_TOOLING=1`, set by the e2e, screenshot,
 *  and perf pipelines). Gates the `window.game` handle: a production build
 *  compiles the publish away entirely (see bootstrap.ts). */
declare const __TOOLING_BUILD__: boolean;
/** True only in a Vercel preview deployment's build (`VERCEL_ENV=preview`).
 *  The page then registers no service worker (see src/build/previewDeploy.ts
 *  and src/deployTarget.ts). */
declare const __PREVIEW_DEPLOY__: boolean;
/** The engine package this shell was built with: its package id and the
 *  digests of the glue and the binary, from src/public/engine/BUILD.json
 *  (see src/wasmhost/enginePackageRecord.ts). Null when the build carries no
 *  usable package. */
/** This build's parts, for the update prompt's "game or engine" label (see
 *  src/pwaUpdateInfo.ts and src/build/buildFingerprint.ts). */
declare const __BUILD_FINGERPRINT__: import("./pwaUpdateInfo").BuildFingerprint;
/** This build's own notes and the ones below it, for the Help menu's What's
 *  new (src/whatsNewData.ts). */
declare const __WHATS_NEW__: import("./changelog").ReleaseNotes[];
declare const __ENGINE_PACKAGE__: import("./wasmhost/enginePackageRecord").ExpectedEnginePackage | null;

/** A help page from help-site/src/content/docs/, compiled at build time by
 *  src/build/helpMarkdown.ts: its front matter and its body as lit templates. */
declare module "*.md" {
  import type { TemplateResult } from "lit-html";
  export const title: string;
  export const description: string;
  /** The whole page body. */
  export const body: () => TemplateResult;
  /** The body before its first second-level heading. */
  export const intro: () => TemplateResult;
}
