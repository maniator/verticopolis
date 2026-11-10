import { afterEach, describe, expect, it, vi } from "vitest";
import { useGermanDefaultLocale } from "../tests/localeStub";

describe("groupDigits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds no formatter on a call", async () => {
    const { groupDigits } = await import("./format");
    const built = vi.spyOn(Intl, "NumberFormat");
    const localized = vi.spyOn(Number.prototype, "toLocaleString");
    groupDigits(1234567);
    groupDigits(42);
    expect(built).not.toHaveBeenCalled();
    expect(localized).not.toHaveBeenCalled();
  });

  it("groups the US way when the browser's default locale is German", async () => {
    useGermanDefaultLocale();
    // The stub works: a formatter with no locale now groups with dots.
    expect(new Intl.NumberFormat().format(1234567)).toBe("1.234.567");
    expect((1234567).toLocaleString()).toBe("1.234.567");
    // A fresh copy of the module, so its formatter is built under the stub.
    vi.resetModules();
    const { groupDigits } = await import("./format");
    expect(groupDigits(1234567)).toBe("1,234,567");
    expect(groupDigits(-999999999)).toBe("-999,999,999");
    expect(groupDigits(0)).toBe("0");
  });
});
