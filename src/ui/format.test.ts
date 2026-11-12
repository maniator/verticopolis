import { afterEach, describe, expect, it, vi } from "vitest";
import { useGermanDefaultLocale } from "../tests/localeStub";
import { ordinal } from "./format";

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

describe("ordinal", () => {
  it("suffixes by the last digit, and the teens by th", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 100, 101, 111, 112, 120, 121, 122, 123].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "100th", "101st", "111th", "112th", "120th", "121st", "122nd", "123rd",
    ]);
  });
});
