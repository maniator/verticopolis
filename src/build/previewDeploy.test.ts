import { describe, expect, it } from "vitest";
import { isPreviewDeploy } from "./previewDeploy";

describe("isPreviewDeploy", () => {
  it("is true only for a Vercel build of a preview deploy", () => {
    expect(isPreviewDeploy({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is false for the production deploy, vercel dev, and builds outside Vercel", () => {
    expect(isPreviewDeploy({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(isPreviewDeploy({ VERCEL: "1", VERCEL_ENV: "development" })).toBe(false);
    expect(isPreviewDeploy({ VERCEL: "1" })).toBe(false);
    expect(isPreviewDeploy({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isPreviewDeploy({})).toBe(false);
  });
});
