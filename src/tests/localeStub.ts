import { vi } from "vitest";

/**
 * Makes German the default locale for number formatting, so a call that
 * leaves the locale out groups with dots ("1.234.567") and shows up. The
 * caller undoes it with `vi.restoreAllMocks()` in an `afterEach`, so a
 * failed assertion cannot leave the stub in place for later tests.
 */
export function useGermanDefaultLocale(): void {
  const RealNumberFormat = Intl.NumberFormat;
  const realToLocaleString = Number.prototype.toLocaleString;
  vi.spyOn(Intl, "NumberFormat").mockImplementation(function (locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    return new RealNumberFormat(locales ?? "de-DE", options);
  } as unknown as typeof Intl.NumberFormat);
  vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    return realToLocaleString.call(this, locales ?? "de-DE", options);
  });
}
